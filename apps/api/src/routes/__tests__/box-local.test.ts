import { describe, expect, it } from "bun:test";
import { createBoxOAuth } from "../../integrations/box/oauth";
import { createLocalBoxApp, readLocalBoxConfig } from "../box-local";

const origin = "http://localhost:3001";
const callback = "/api/box/oauth/callback";
const config = {
  clientId: "test-client",
  clientSecret: "private-client",
  redirectUri: origin + callback,
};

function fixture({
  secondStudentPageFails = false,
  writeStatuses = new Map<string, number>(),
} = {}) {
  let now = Date.now();
  const oauthCalls: string[] = [];
  const metadataCalls: string[] = [];
  const folderWrites: { name: string; parent: { id: string } }[] = [];
  const oauth = createBoxOAuth(
    config,
    async (url) => {
      oauthCalls.push(url);
      return url.endsWith("/revoke")
        ? new Response(null)
        : Response.json({
            access_token: "private-access",
            refresh_token: "private-refresh",
            expires_in: 3600,
            token_type: "bearer",
          });
    },
    () => now
  );
  const makeApp = () =>
    createLocalBoxApp(
      origin,
      oauth,
      async (url, init) => {
        expect(new Headers(init.headers).get("Authorization")).toBe(
          "Bearer private-access"
        );
        expect(init.redirect).toBe("error");
        const path = new URL(url);
        if (init.method === "POST") {
          expect(path.origin + path.pathname).toBe("https://api.box.com/2.0/folders");
          expect(path.searchParams.get("fields")).toBe("id,type,name,parent");
          expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
          const folder = JSON.parse(String(init.body)) as (typeof folderWrites)[number];
          folderWrites.push(folder);
          const status = writeStatuses.get(folder.name) ?? 201;
          return status === 201
            ? Response.json({ ...folder, type: "folder", id: "999" }, { status })
            : Response.json({ message: "private upstream details" }, { status });
        }
        metadataCalls.push(url);
        const id = path.pathname.split("/")[3];
        if (!path.pathname.endsWith("/items")) {
          const name =
            id === "0" ? "All Files" : id === "457" ? "Smith_Jane" : "<Nested>";
          return Response.json({ id, name });
        }
        expect(path.searchParams.get("fields")).toBe(
          "id,type,name,created_at,modified_at"
        );
        if (id === "457") {
          const marker = path.searchParams.get("marker");
          if (marker === "student-next") {
            if (secondStudentPageFails) return new Response(null, { status: 503 });
            return Response.json({
              entries: [
                { id: "9", name: "PATCH.pdf", type: "file" },
                { id: "10", name: "SDP.pdf", type: "file" },
                { id: "11", name: "test.pdf", type: "file" },
              ],
              next_marker: null,
            });
          }
          if (marker !== null) return new Response(null, { status: 400 });
          return Response.json({
            entries: [
              { id: "1", name: "PCA.pdf", type: "file" },
              { id: "2", name: "MR.pdf", type: "file" },
              { id: "3", name: "FBI.PDF", type: "file" },
              { id: "4", name: "FBI.pdf", type: "folder" },
              { id: "5", name: "INTL.pdf", type: "web_link" },
            ],
            next_marker: "student-next",
          });
        }
        return id === "0"
          ? Response.json({
              entries: [{ id: "456", name: "<Nested>", type: "folder" }],
              next_marker: "cursor+/=",
            })
          : Response.json({
              entries: [
                {
                  id: "789",
                  name: "<img src=x>.pdf",
                  type: "file",
                  shared_link: "private-link",
                  download_url: "private-download",
                },
                { id: "888", name: "ignored web link", type: "web_link" },
              ],
              next_marker: null,
            });
      },
      () => now
    );
  const app = makeApp();
  const get = (path: string, cookie?: string) =>
    app.request(origin + path, { headers: cookie ? { Cookie: cookie } : {} });
  const post = (
    path: string,
    cookie?: string,
    body?: URLSearchParams | FormData,
    requestOrigin = origin
  ) =>
    app.request(origin + path, {
      method: "POST",
      headers: { Origin: requestOrigin, ...(cookie ? { Cookie: cookie } : {}) },
      body,
    });
  function browserCookie(response: Response, name: string) {
    const cookie = response.headers
      .getSetCookie()
      .find((line) => line.startsWith(name + "="));
    if (!cookie) throw new Error("Missing browser cookie");
    return cookie.split(";")[0] ?? "";
  }
  async function start(upgrade?: { folderId: string; session: string }) {
    const path = upgrade ? `/signin?writeTo=${upgrade.folderId}` : "/signin";
    const response = await app.request(origin + path, {
      headers: {
        "Sec-Fetch-Site": "same-origin",
        ...(upgrade ? { Cookie: upgrade.session } : {}),
      },
    });
    expect(response.status).toBe(303);
    const authorization = new URL(response.headers.get("Location") ?? "");
    expect(authorization.origin).toBe("https://account.box.com");
    expect(authorization.searchParams.get("scope")).toBe(
      upgrade ? "root_readonly root_readwrite" : "root_readonly"
    );
    return {
      path: callback + "?code=fixture&state=" + authorization.searchParams.get("state"),
      cookie: browserCookie(response, "netter_box_local_attempt"),
    };
  }
  async function connect(upgrade?: { folderId: string; session: string }) {
    const attempt = await start(upgrade);
    const response = await get(attempt.path, attempt.cookie);
    expect(response.headers.get("Location")).toBe(
      upgrade && upgrade.folderId !== "0" ? `/folders/${upgrade.folderId}` : "/"
    );
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    return { ...attempt, session: browserCookie(response, "netter_box_local_session") };
  }
  async function connectWritable() {
    return connect({ folderId: "0", session: (await connect()).session });
  }
  return {
    app,
    makeApp,
    get,
    post,
    start,
    connect,
    connectWritable,
    oauthCalls,
    metadataCalls,
    folderWrites,
    expire: () => {
      now += 3600_000;
    },
  };
}

function csvForm(content: string) {
  const form = new FormData();
  form.append("csv", new File([content], "students.csv", { type: "text/csv" }));
  return form;
}

describe("standalone Box viewer", () => {
  it("starts with just the three OAuth settings and rejects other hosts or production", () => {
    const env = {
      BOX_CLIENT_ID: config.clientId,
      BOX_CLIENT_SECRET: config.clientSecret,
      BOX_REDIRECT_URI: config.redirectUri,
    };
    expect(readLocalBoxConfig(env)).toMatchObject({
      origin,
      hostname: "localhost",
      port: 3001,
    });
    expect(() => readLocalBoxConfig({ ...env, NODE_ENV: "production" })).toThrow(
      "loopback callback"
    );
    expect(() =>
      readLocalBoxConfig({
        ...env,
        BOX_REDIRECT_URI: "http://localhost.attacker.test:3001" + callback,
      })
    ).toThrow("loopback callback");
  });

  it("blocks browser requests from other origins and protects folder listings before OAuth", async () => {
    const f = fixture();
    expect((await f.get("/folders/456")).status).toBe(303);
    expect(await (await f.get("/")).text()).toContain(
      '<a href="/signin">Sign in with Box</a>'
    );
    expect((await f.app.request("http://other.test/", {})).status).toBe(403);
    const crossSiteSignIn = await f.app.request(origin + "/signin", {
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(crossSiteSignIn.status).toBe(403);
    expect(crossSiteSignIn.headers.get("Set-Cookie")).toBeNull();
    expect((await f.get("/signin")).status).toBe(403);
    expect(
      (
        await f.app.request(origin + "/signout", {
          method: "POST",
          headers: { Origin: "http://other.test" },
        })
      ).status
    ).toBe(403);
    expect(f.oauthCalls).toEqual([]);
    expect(f.metadataCalls).toEqual([]);
  });

  it("binds the authorization code to the initiating browser and rejects replay", async () => {
    const f = fixture();
    const attempt = await f.start();
    expect((await f.get(attempt.path)).status).toBe(400);
    expect((await f.get(attempt.path + "&state=duplicate", attempt.cookie)).status).toBe(
      400
    );
    const responses = await Promise.all([
      f.get(attempt.path, attempt.cookie),
      f.get(attempt.path, attempt.cookie),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([303, 400]);
    expect(f.oauthCalls).toEqual(["https://api.box.com/oauth2/token"]);
  });

  it("browses root and nested folders, preserves paging, and serves names as text", async () => {
    const f = fixture();
    const { session } = await f.connect();
    const root = await f.get("/", session);
    expect(root.headers.get("Cache-Control")).toBe("no-store");
    const rootHtml = await root.text();
    expect(rootHtml).toContain('href="/folders/456"');
    expect(rootHtml).toContain('href="/?marker=cursor%2B%2F%3D"');
    expect(rootHtml).not.toContain("Requirements for");
    await f.get("/?marker=cursor%2B%2F%3D", session);
    expect(f.metadataCalls.at(-1)).toContain("marker=cursor%2B%2F%3D");
    const nested = await f.get("/folders/456", session);
    const output = await nested.text();
    expect(output).toContain("Requirements for &lt;Nested&gt;");
    expect(output.split("Unidentified files")[1]).toContain("&lt;img src=x&gt;.pdf");
    expect(output).not.toMatch(
      /<img|ignored web link|private-(link|download|access|refresh|client)/
    );
    const callCount = f.metadataCalls.length;
    expect((await f.get("/folders/%2e%2e%2f123", session)).status).toBe(400);
    expect((await f.get("/folders/456?fields=shared_link", session)).status).toBe(400);
    expect((await f.get("/files/789/content", session)).status).toBe(404);
    expect(f.metadataCalls).toHaveLength(callCount);
  });

  it("checks exact file names across the student folder from either displayed page", async () => {
    const f = fixture();
    const { session } = await f.connect();
    const path = "/folders/457";
    const first = await f.get(path, session);
    expect(first.status).toBe(200);
    const output = await first.text();
    const [listing, requirements] = output.split("<h3>Requirements for Jane Smith</h3>");
    expect(listing).toContain("File: PCA.pdf");
    expect(listing).toContain(`href="${path}?marker=student-next"`);
    expect(listing).not.toContain("File: PATCH.pdf");
    expect(requirements).toContain("Required for everyone");
    expect(requirements).toContain("Depends");
    const statuses = Array.from(
      requirements?.matchAll(/<code>([^<]+)<\/code>\) —\s+<strong>([^<]+)<\/strong>/g) ??
        [],
      ([, filename, status]) => [filename, status]
    );
    expect(statuses).toEqual([
      ["PCA.pdf", "Met"],
      ["PATCH.pdf", "Met"],
      ["FBI.pdf", "Missing"],
      ["MR.pdf", "Met"],
      ["SDP.pdf", "Met"],
      ["INTL.pdf", "Missing"],
    ]);
    const unidentified = requirements?.split("Unidentified files")[1];
    expect(unidentified?.match(/<li>[^<]+<\/li>/g)).toEqual([
      "<li>FBI.PDF</li>",
      "<li>test.pdf</li>",
    ]);
    expect(f.metadataCalls).toHaveLength(3);

    const second = await f.get(path + "?marker=student-next", session);
    expect(second.status).toBe(200);
    const [secondListing, secondRequirements] = (await second.text()).split(
      "<h3>Requirements for Jane Smith</h3>"
    );
    expect(secondListing).toContain("File: PATCH.pdf");
    expect(secondRequirements).toBe(requirements);
    expect(f.metadataCalls).toHaveLength(6);
    expect((await f.get(path + "?marker=invalid", session)).status).toBe(400);
  });

  it("keeps the file list visible without reporting partial requirement statuses", async () => {
    const f = fixture({ secondStudentPageFails: true });
    const { session } = await f.connect();
    const response = await f.get("/folders/457", session);
    expect(response.status).toBe(200);
    const output = await response.text();
    expect(output).toContain("File: PCA.pdf");
    expect(output).toContain("Could not check all files in this folder.");
    expect(output).not.toContain("<strong>Missing</strong>");
    expect(output).not.toContain("<strong>Met</strong>");
  });

  it("forgets sessions on restart or expiry and revokes on sign-out", async () => {
    const f = fixture();
    const first = await f.connect();
    const restarted = await f
      .makeApp()
      .request(origin + "/", { headers: { Cookie: first.session } });
    expect(await restarted.text()).toContain("Sign in with Box");
    f.expire();
    expect(await (await f.get("/", first.session)).text()).toContain("Sign in with Box");
    const { session } = await f.connect();
    expect((await f.post("/signout", session)).status).toBe(303);
    expect(f.oauthCalls.at(-1)).toBe("https://api.box.com/oauth2/revoke");
    expect(await (await f.get("/", session)).text()).toContain("Sign in with Box");
    expect(f.metadataCalls).toEqual([]);
  });

  it("gates both write routes on successful Box write authorization and same-origin POSTs", async () => {
    const f = fixture();
    const { session: readSession } = await f.connect();
    const folder = await (await f.get("/folders/457", readSession)).text();
    expect(folder).toContain('href="/signin?writeTo=457">Enable folder creation</a>');
    expect(folder).not.toContain("Add student folders");
    const submissions = [
      ["/folders/0/create", new URLSearchParams({ name: "John Smith" })],
      ["/folders/0/import", csvForm("John,Smith")],
    ] as const;
    for (const [path, body] of submissions) {
      expect((await f.post(path, readSession, body)).status).toBe(403);
      expect((await f.post(path, undefined, body)).status).toBe(401);
    }
    const headers = { "Sec-Fetch-Site": "same-origin", Cookie: readSession };
    const wrongFolder = await f.app.request(origin + "/signin?writeTo=%2F%2Fother.test", {
      headers,
    });
    expect(wrongFolder.status).toBe(400);
    expect(
      (
        await f.app.request(origin + "/signin?writeTo=457", {
          headers: { ...headers, "Sec-Fetch-Site": "cross-site" },
        })
      ).status
    ).toBe(403);

    const denied = await f.start({ folderId: "457", session: readSession });
    const rejection = await f.get(
      denied.path.replace("code=fixture", "error=access_denied"),
      denied.cookie
    );
    expect(rejection.headers.get("Location")).toBe("/folders/457?write=failed");
    const retry = await (await f.get("/folders/457?write=failed", readSession)).text();
    expect(retry).toContain("Box write authorization did not complete");
    expect(retry).toContain("Enable folder creation");
    expect(retry).not.toContain("Add student folders");

    const { session } = await f.connect({ folderId: "457", session: readSession });
    expect(await (await f.get("/folders/457", session)).text()).toContain(
      'action="/folders/457/create"'
    );
    for (const [path, body] of submissions) {
      expect((await f.post(path, readSession, body)).status).toBe(401);
      expect((await f.post(path, session, body, "https://other.test")).status).toBe(403);
    }
    f.expire();
    for (const [path, body] of submissions) {
      expect((await f.post(path, session, body)).status).toBe(401);
    }
    expect(f.folderWrites).toEqual([]);
  });

  it("validates manual input and creates exactly one normalized folder in the selected parent", async () => {
    const f = fixture();
    const { session } = await f.connectWritable();
    const root = await (await f.get("/", session)).text();
    expect(root).toContain('action="/folders/0/create"');
    expect(root).toContain('action="/folders/0/import"');
    const path = "/folders/457/create";
    expect((await f.post(path, session, csvForm("John,Smith"))).status).toBe(415);
    for (const name of [
      "John",
      "John Smith/Other",
      "John Smith_Name",
      "John " + "x".repeat(256),
    ]) {
      expect((await f.post(path, session, new URLSearchParams({ name }))).status).toBe(
        400
      );
    }
    const name = new URLSearchParams({ name: "  John   Smith  " });
    expect((await f.post("/folders/%2e%2e%2f123/create", session, name)).status).toBe(
      400
    );
    expect(f.folderWrites).toEqual([]);

    const response = await f.post(path, session, name);
    expect(response.status).toBe(201);
    expect(await response.text()).toContain('<a href="/folders/999">SMITH_JOHN</a>');
    expect(f.folderWrites).toEqual([{ name: "SMITH_JOHN", parent: { id: "457" } }]);
  });

  it("validates the entire CSV before any writes, then imports distinct names and reports Box conflicts", async () => {
    const f = fixture({
      writeStatuses: new Map([["SMITH_JOHN", 409]]),
    });
    const { session } = await f.connectWritable();
    const path = "/folders/0/import";
    expect(
      (await f.post(path, session, new URLSearchParams({ csv: "John,Smith" }))).status
    ).toBe(415);
    for (const csv of [
      "",
      "John,Smith\nMary",
      'John,Smith\n"broken',
      "John,Smith,Other",
      "John,Smith\nMary,",
      "John,Smith\n".repeat(101),
    ]) {
      expect((await f.post(path, session, csvForm(csv))).status).toBe(400);
    }
    expect((await f.post(path, session, csvForm("x".repeat(65_537)))).status).toBe(413);
    expect(f.folderWrites).toEqual([]);

    const response = await f.post(
      path,
      session,
      csvForm(
        '\ufeffFirst Name,Last Name\r\nJohn,Smith\r\n"Ana María","de la Cruz"\r\njohn,smith\r\n'
      )
    );
    expect(response.status).toBe(200);
    const result = await response.text();
    expect(result).toContain("SMITH_JOHN — Name already in use");
    expect(result).toContain(">DE LA CRUZ_ANA MARÍA</a> — Created");
    expect(result).toContain("Repeated names skipped: 1");
    expect(result).not.toContain("private upstream details");
    expect(f.folderWrites).toEqual([
      { name: "SMITH_JOHN", parent: { id: "0" } },
      { name: "DE LA CRUZ_ANA MARÍA", parent: { id: "0" } },
    ]);
  });

  it("reports a partial import and stops further writes when Box rate limits it", async () => {
    const f = fixture({
      writeStatuses: new Map([["JONES_JANE", 429]]),
    });
    const { session } = await f.connectWritable();
    const response = await f.post(
      "/folders/457/import",
      session,
      csvForm("John,Smith\nJane,Jones\nAlex,Lee")
    );
    expect(response.status).toBe(200);
    const result = await response.text();
    expect(result).toContain(">SMITH_JOHN</a> — Created");
    expect(result).toContain("JONES_JANE — Box is rate limiting creation");
    expect(result).toContain("LEE_ALEX — Not attempted");
    expect(f.folderWrites).toEqual([
      { name: "SMITH_JOHN", parent: { id: "457" } },
      { name: "JONES_JANE", parent: { id: "457" } },
    ]);
  });
});
