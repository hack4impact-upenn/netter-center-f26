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

function fixture() {
  let now = Date.now();
  const oauthCalls: string[] = [];
  const metadataCalls: string[] = [];
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
        metadataCalls.push(url);
        const path = new URL(url);
        const id = path.pathname.split("/")[3];
        if (!path.pathname.endsWith("/items"))
          return Response.json({ id, name: id === "0" ? "All Files" : "<Nested>" });
        expect(path.searchParams.get("fields")).toBe(
          "id,type,name,created_at,modified_at"
        );
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
  const post = (path: string, cookie?: string) =>
    app.request(origin + path, {
      method: "POST",
      headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
    });
  function browserCookie(response: Response, name: string) {
    const cookie = response.headers
      .getSetCookie()
      .find((line) => line.startsWith(name + "="));
    if (!cookie) throw new Error("Missing browser cookie");
    return cookie.split(";")[0] ?? "";
  }
  async function start() {
    const response = await post("/signin");
    expect(response.status).toBe(303);
    const authorization = new URL(response.headers.get("Location") ?? "");
    expect(authorization.origin).toBe("https://account.box.com");
    expect(authorization.searchParams.get("scope")).toBe("root_readonly");
    return {
      path: callback + "?code=fixture&state=" + authorization.searchParams.get("state"),
      cookie: browserCookie(response, "netter_box_local_attempt"),
    };
  }
  async function connect() {
    const attempt = await start();
    const response = await get(attempt.path, attempt.cookie);
    expect(response.headers.get("Location")).toBe("/");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    return { ...attempt, session: browserCookie(response, "netter_box_local_session") };
  }
  return {
    app,
    makeApp,
    get,
    post,
    start,
    connect,
    oauthCalls,
    metadataCalls,
    expire: () => {
      now += 3600_000;
    },
  };
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
    expect(await (await f.get("/")).text()).toContain("Sign in with Box");
    expect((await f.app.request("http://other.test/", {})).status).toBe(403);
    expect(
      (
        await f.app.request(origin + "/signin", {
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
    await f.get("/?marker=cursor%2B%2F%3D", session);
    expect(f.metadataCalls.at(-1)).toContain("marker=cursor%2B%2F%3D");
    const nested = await f.get("/folders/456", session);
    const output = await nested.text();
    expect(output).toContain("&lt;Nested&gt;");
    expect(output).toContain("&lt;img src=x&gt;.pdf");
    expect(output).not.toMatch(
      /<img|ignored web link|private-(link|download|access|refresh|client)/
    );
    const callCount = f.metadataCalls.length;
    expect((await f.get("/folders/%2e%2e%2f123", session)).status).toBe(400);
    expect((await f.get("/folders/456?fields=shared_link", session)).status).toBe(400);
    expect((await f.get("/files/789/content", session)).status).toBe(404);
    expect(f.metadataCalls).toHaveLength(callCount);
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
});
