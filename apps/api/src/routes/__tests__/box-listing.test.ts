import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import {
  KEY,
  openDatabase,
  seedUsers,
  sqliteQuery,
  TOKENS,
} from "../../integrations/box/__tests__/fixtures";
import { createBoxConnectionService } from "../../integrations/box/connection-service";
import { LISTING_WORKER_PATH } from "../../integrations/box/listing-contract";
import { createListingWorker } from "../../integrations/box/listing-worker";
import {
  createListingWorkerClient,
  inspectListingWorker,
} from "../../integrations/box/listing-worker-client";
import { createBoxOAuth } from "../../integrations/box/oauth";
import { BoxStore } from "../../integrations/box/store";
import { createRequireAuth } from "../../middleware/auth";
import type { AppEnv } from "../../types";
import { createBoxRoutes } from "../box";

const endpoint = "https://worker.example.test" + LISTING_WORKER_PATH;
const secret = "a".repeat(64);
const token = "restricted-fixture-token";
const folderId = "900719925474099312345";
const folderPath = "/api/box/folders/" + folderId + "/files";
const owner = { Authorization: "Bearer session-1" };
const boxUrl = "https://api.box.com/2.0/folders/" + folderId;
const date = "2026-11-17T12:00:00-05:00";
const marker = "opaque+/=&cursor";
const file = {
  id: "198",
  type: "file",
  name: 'Résumé <draft> "1".pdf',
  created_at: date,
  modified_at: null,
  download_url: "private-download",
  shared_link: { url: "private-link" },
  expiring_embed_link: "private-preview",
};
const expectedFile = { id: file.id, name: file.name, createdAt: date, modifiedAt: null };
const scopeResponse = {
  access_token: token,
  token_type: "bearer",
  expires_in: 900,
  restricted_to: [{ scope: "base_explorer", object: { id: folderId, type: "folder" } }],
};

type Call = { url: string; init: RequestInit };
type Handler = (call: Call) => Response | Promise<Response> | undefined;

describe("GET Box folder files through the OAuth and worker boundary", () => {
  let db: Database;
  let app: Hono<AppEnv>;
  let store: BoxStore;
  let connectionId: string;
  let now: number;
  let policy: Handler;
  let metadata: Handler;
  let workerResponse: Handler;
  let credentialCalls: Call[];
  let workerCalls: Call[];
  let boxMetadataCalls: Call[];

  beforeEach(async () => {
    now = Date.now();
    db = openDatabase();
    seedUsers(db);
    db.run("UPDATE sessions SET expires_at = ?", [
      new Date(now + 86_400_000).toISOString(),
    ]);
    const query = sqliteQuery(db);
    store = new BoxStore({ encryptionKey: KEY, query, now: () => now });
    const conn = await store.saveConnection({
      userId: "user-1",
      boxUserId: "321",
      tokens: TOKENS,
      accessExpiresAt: now + 600_000,
    });
    if (!conn) throw new Error("Failed to seed connection");
    connectionId = conn.id;
    await store.grantFolder("user-1", connectionId, folderId);
    credentialCalls = [];
    workerCalls = [];
    boxMetadataCalls = [];
    policy = metadata = workerResponse = () => undefined;
    const oauth = createBoxOAuth(
      {
        clientId: "fixture-client",
        clientSecret: "fixture-client-secret",
        redirectUri: "https://api.example.test/api/box/oauth/callback",
      },
      async (url, init) => {
        const call = { url, init };
        credentialCalls.push(call);
        return policy(call) ?? Response.json(scopeResponse);
      },
      () => now
    );
    const worker = createListingWorker(secret, async (url, init) => {
      const call = { url, init };
      boxMetadataCalls.push(call);
      const custom = metadata(call);
      if (custom) return custom;
      return new URL(url).pathname.endsWith("/items")
        ? Response.json({
            entries: [
              file,
              { type: "folder", id: "222" },
              { type: "web_link", id: "333" },
            ],
            next_marker: marker,
          })
        : Response.json({
            id: folderId,
            name: "  Synthetic & folder  ",
            description: "private description",
          });
    });
    const listFolder = createListingWorkerClient(
      { endpoint, secret },
      async (url, init) => {
        const call = { url, init };
        workerCalls.push(call);
        return workerResponse(call) ?? worker(new Request(url, init));
      }
    );
    app = new Hono<AppEnv>();
    app.route(
      "/api/box",
      createBoxRoutes(
        {
          service: createBoxConnectionService(store, oauth, () => now),
          secureCookies: true,
          listFolder,
        },
        createRequireAuth(query)
      )
    );
  });
  afterEach(() => db.close());

  function get(suffix = "", headers = owner) {
    return app.request(folderPath + suffix, { headers });
  }

  function expectNoUpstream() {
    expect(credentialCalls).toHaveLength(0);
    expect(workerCalls).toHaveLength(0);
    expect(boxMetadataCalls).toHaveLength(0);
  }

  it("requires an unexpired Bearer session before validation or Box work", async () => {
    for (const authorization of [null, "Basic session-1", "Bearer invalid"]) {
      const headers = authorization
        ? new Headers({ Authorization: authorization })
        : new Headers();
      const response = await app.request(folderPath, { headers });
      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    db.run("UPDATE sessions SET expires_at = ? WHERE token = 'session-1'", [
      new Date(now - 1000).toISOString(),
    ]);
    expect((await get()).status).toBe(401);
    expectNoUpstream();
  });

  it("conceals missing, revoked and other users' grants without contacting Box", async () => {
    for (const response of [
      await get("", { Authorization: "Bearer session-2" }),
      await app.request("/api/box/folders/1234/files", { headers: owner }),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        code: "not_found",
        error: "Folder not found",
      });
    }
    await store.revokeFolder("user-1", folderId);
    expect((await get()).status).toBe(404);
    expectNoUpstream();
  });

  it("rejects a path-like folder ID", async () => {
    const invalid = "%2e%2e%2f123";
    expect(
      (await app.request("/api/box/folders/" + invalid + "/files", { headers: owner }))
        .status
    ).toBe(400);
    expectNoUpstream();
  });

  it.each(["?limit=1001", "?marker=a&marker=b", "?fields=shared_link"])(
    "rejects invalid pagination or extra parameters %#",
    async (suffix) => {
      expect((await get(suffix)).status).toBe(400);
      expectNoUpstream();
    }
  );

  it("lists exact names and timestamps with only authorized metadata on both sides of the worker", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      folderId,
      folderName: "  Synthetic & folder  ",
      files: [expectedFile],
      nextMarker: marker,
    });
    expect(credentialCalls[0]?.url).toBe("https://api.box.com/oauth2/token");
    expect(Object.fromEntries(credentialCalls[0]?.init.body as URLSearchParams)).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: TOKENS.accessToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      scope: "base_explorer",
      resource: boxUrl,
    });
    expect(workerCalls).toHaveLength(1);
    const sent = workerCalls[0];
    expect(sent?.url).toBe(endpoint);
    expect(new Headers(sent?.init.headers).get("Authorization")).toBe("Bearer " + secret);
    expect(JSON.parse(String(sent?.init.body))).toEqual({ folderId, limit: 100, token });
    expect(boxMetadataCalls.map(({ url }) => url)).toEqual([
      boxUrl + "?fields=id,name",
      boxUrl +
        "/items?fields=id%2Ctype%2Cname%2Ccreated_at%2Cmodified_at&usemarker=true&limit=100",
    ]);
    for (const { init } of [...credentialCalls, ...workerCalls, ...boxMetadataCalls]) {
      expect(init.redirect).toBe("error");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    for (const { init } of boxMetadataCalls) {
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer " + token);
    }
  });

  it("demands another page even when an intermediate page only contains folders", async () => {
    metadata = ({ url }) => {
      const request = new URL(url);
      if (!request.pathname.endsWith("/items")) return undefined;
      expect(request.searchParams.get("limit")).toBe("1");
      return request.searchParams.get("marker") === marker
        ? Response.json({
            entries: [{ ...file, created_at: undefined }],
            next_marker: null,
          })
        : Response.json({
            entries: [{ type: "folder", id: "222" }],
            next_marker: marker,
          });
    };
    expect(await (await get("?limit=1")).json()).toMatchObject({
      files: [],
      nextMarker: marker,
    });
    expect(
      await (await get("?limit=1&marker=" + encodeURIComponent(marker))).json()
    ).toMatchObject({ files: [{ ...expectedFile, createdAt: null }], nextMarker: null });
    expect(credentialCalls).toHaveLength(2);
  });

  it.each([
    { restricted_to: [...scopeResponse.restricted_to, { scope: "item_download" }] },
    {
      restricted_to: [{ scope: "base_explorer", object: { id: "555", type: "folder" } }],
    },
    { access_token: TOKENS.accessToken },
  ])("fails closed on invalid token restrictions %#", async (change) => {
    policy = () => Response.json({ ...scopeResponse, ...change });
    expect((await get()).status).toBe(502);
    expect(credentialCalls).toHaveLength(1);
    expect(workerCalls).toHaveLength(0);
  });

  it("rechecks the grant after exchanging the token and before calling the worker", async () => {
    policy = async () => {
      await store.revokeFolder("user-1", folderId);
      return Response.json(scopeResponse);
    };
    expect((await get()).status).toBe(404);
    expect(workerCalls).toHaveLength(0);
  });

  it("retries downscoping once after refreshing a rejected parent token", async () => {
    policy = ({ init }) => {
      const form = init.body as URLSearchParams;
      if (form.get("subject_token") === TOKENS.accessToken)
        return new Response(null, { status: 401 });
      if (form.get("refresh_token") === TOKENS.refreshToken)
        return Response.json({
          access_token: "rotated-parent",
          refresh_token: "rotated-refresh",
          expires_in: 3600,
          token_type: "bearer",
        });
      expect(form.get("subject_token")).toBe("rotated-parent");
      return Response.json(scopeResponse);
    };
    expect((await get()).status).toBe(200);
    expect(credentialCalls).toHaveLength(3);
    expect(workerCalls).toHaveLength(1);
  });

  it("maps a rejected marker and preserves a safe rate-limit retry interval", async () => {
    metadata = ({ url }) =>
      url.includes("/items?") ? new Response("private", { status: 400 }) : undefined;
    const denied = await get("?marker=invalid");
    expect(denied.status).toBe(400);
    expect(await denied.json()).toMatchObject({ code: "invalid_page" });
    metadata = () =>
      new Response("private", { status: 429, headers: { "Retry-After": "42" } });
    const limited = await get();
    expect(limited.status).toBe(503);
    expect(limited.headers.get("Retry-After")).toBe("42");
    expect(await limited.json()).toMatchObject({ code: "rate_limited" });
    metadata = () =>
      new Response(null, { status: 429, headers: { "Retry-After": "secret-invalid" } });
    expect((await get()).headers.get("Retry-After")).toBeNull();
  });

  it("distinguishes upstream timeouts and prevents leaking transport diagnostics", async () => {
    metadata = () => {
      throw new DOMException("private upstream payload", "TimeoutError");
    };
    const response = await get();
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      code: "timeout",
      error: "Box listing timed out",
    });
    workerResponse = () => {
      throw new Error("private worker credentials");
    };
    expect(await (await get()).json()).toEqual({
      code: "upstream",
      error: "Box listing failed",
    });
  });

  it("revalidates and allowlists worker response fields in the API", async () => {
    workerResponse = () =>
      Response.json({
        folderId,
        folderName: "Fixture",
        files: [{ ...expectedFile, preview: "secret-preview" }],
        nextMarker: null,
        token,
        description: "secret-extra",
      });
    const response = await get();
    expect(await response.json()).toEqual({
      folderId,
      folderName: "Fixture",
      files: [expectedFile],
      nextMarker: null,
    });
    workerResponse = () =>
      Response.json({
        folderId: "555",
        folderName: "Wrong",
        files: [],
        nextMarker: null,
      });
    expect((await get()).status).toBe(502);
  });

  it("fails closed when listing has no configured worker", async () => {
    const disabled = new Hono<AppEnv>().route(
      "/api/box",
      createBoxRoutes(null, createRequireAuth(sqliteQuery(db)))
    );
    expect((await disabled.request(folderPath, { headers: owner })).status).toBe(503);
    expectNoUpstream();
  });
});

describe("private Box listing worker", () => {
  it("authenticates before parsing the payload and refuses non-listing routes", async () => {
    const worker = createListingWorker(secret, async () => {
      throw new Error("Must not contact Box");
    });
    for (const auth of ["", "Bearer " + "b".repeat(64), "Bearer " + token]) {
      const response = await worker(
        new Request(endpoint, {
          method: "POST",
          body: "{",
          headers: { Authorization: auth },
        })
      );
      expect(response.status).toBe(401);
    }
    expect(
      (
        await worker(
          new Request(endpoint, { headers: { Authorization: "Bearer " + secret } })
        )
      ).status
    ).toBe(404);
    expect(
      (
        await worker(
          new Request("https://worker.example.test/oauth2/token", {
            method: "POST",
            headers: { Authorization: "Bearer " + secret },
          })
        )
      ).status
    ).toBe(404);
  });

  it("requires an affirmative permission verification setting even with valid worker credentials", () => {
    const env = {
      BOX_LISTING_WORKER_SECRET: secret,
      BOX_LISTING_WORKER_URL: "https://worker.example.test",
    };
    for (const flag of [undefined, "false", "TRUE"]) {
      expect(
        inspectListingWorker({ ...env, BOX_LISTING_PERMISSIONS_VERIFIED: flag })
      ).toBeNull();
    }
    expect(
      inspectListingWorker({ ...env, BOX_LISTING_PERMISSIONS_VERIFIED: "true" })
    ).toEqual({ endpoint, secret });
  });

  it("enforces HTTPS in production and accepts loopback HTTP for local setup", () => {
    const env = {
      BOX_LISTING_PERMISSIONS_VERIFIED: "true",
      BOX_LISTING_WORKER_SECRET: secret,
      BOX_LISTING_WORKER_URL: "http://127.0.0.1:3002",
    };
    expect(inspectListingWorker(env)?.endpoint).toBe(
      "http://127.0.0.1:3002" + LISTING_WORKER_PATH
    );
    expect(inspectListingWorker({ ...env, NODE_ENV: "production" })).toBeNull();
    expect(
      inspectListingWorker({
        ...env,
        NODE_ENV: "production",
        BOX_LISTING_WORKER_URL: "https://worker.example.test",
      })
    ).toEqual({ endpoint, secret });
  });
});
