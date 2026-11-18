import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import {
  KEY,
  openDatabase,
  seedUsers,
  sqliteQuery,
  TOKENS,
} from "../../integrations/box/__tests__/fixtures";
import { createBoxConnectionService } from "../../integrations/box/connection-service";
import { createBoxOAuth } from "../../integrations/box/oauth";
import { BoxStore } from "../../integrations/box/store";
import { createRequireAuth } from "../../middleware/auth";
import type { AppEnv } from "../../types";
import { createBoxRoutes } from "../box";

const callbackPath = "/api/box/oauth/callback";
const config = {
  clientId: "fixture-client-id",
  clientSecret: "fixture-client-secret",
  redirectUri: "https://api.example.test" + callbackPath,
};
const access = "upstream-private-access";
const refresh = "upstream-private-refresh";
const code = "box-private-code";
const headers = { Authorization: "Bearer session-1" };
const other = { Authorization: "Bearer session-2" };

function tokenResponse(accessToken = access, refreshToken = refresh) {
  return Response.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "bearer",
    expires_in: 3600,
  });
}

describe("Box OAuth routes with SQLite and a fake Box transport", () => {
  let db: Database;
  let app: Hono<AppEnv>;
  let store: BoxStore;
  let now: number;
  let calls: { url: string; init: RequestInit; form: Record<string, string> }[];
  let override: (
    url: string,
    form: Record<string, string>
  ) => Response | Promise<Response> | undefined;

  beforeEach(() => {
    now = Date.now();
    db = openDatabase();
    seedUsers(db);
    db.run("UPDATE sessions SET expires_at = ?", [
      new Date(now + 86_400_000).toISOString(),
    ]);
    calls = [];
    override = () => undefined;
    store = new BoxStore({ encryptionKey: KEY, query: sqliteQuery(db), now: () => now });
    const oauth = createBoxOAuth(
      config,
      async (url, init) => {
        const form =
          init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : {};
        calls.push({ url, init, form });
        const response = override(url, form);
        if (response) return response;
        if (url.endsWith("/oauth2/token")) return tokenResponse();
        if (url.endsWith("/users/me?fields=id"))
          return Response.json({ id: "123456", login: "private@example.test" });
        if (url.endsWith("/oauth2/revoke")) return new Response(null, { status: 200 });
        throw new Error("Unexpected Box request");
      },
      () => now
    );
    app = new Hono<AppEnv>();
    app.route(
      "/api/box",
      createBoxRoutes(
        {
          service: createBoxConnectionService(store, oauth, () => now),
          secureCookies: true,
        },
        createRequireAuth(sqliteQuery(db))
      )
    );
  });
  afterEach(() => db.close());

  async function start(sessionHeaders = headers) {
    const response = await app.request("/api/box/connect", {
      method: "POST",
      headers: sessionHeaders,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { authorizationUrl: string };
    const url = new URL(body.authorizationUrl);
    const state = url.searchParams.get("state");
    const setCookie = response.headers.get("Set-Cookie");
    const cookie = setCookie?.split(";")[0];
    if (!state || !cookie) throw new Error("Missing OAuth attempt fixture");
    return { url, state, cookie, setCookie, response };
  }

  function callback(attempt: { state: string; cookie: string }, query = "code=" + code) {
    return app.request(`${callbackPath}?state=${attempt.state}&${query}`, {
      headers: { Cookie: attempt.cookie },
    });
  }

  async function seedConnection(accessExpiresAt = now + 3600_000, userId = "user-1") {
    const result = await store.saveConnection({
      userId,
      boxUserId: "123456",
      tokens: TOKENS,
      accessExpiresAt,
    });
    if (!result) throw new Error("Cannot seed Box connection");
    return result;
  }

  it.each([
    ["POST", "/connect"],
    ["GET", "/connection"],
    ["DELETE", "/connection"],
  ])("requires a live app session for %s %s", async (method, path) => {
    for (const authorization of [undefined, "Basic session-1", "Bearer unknown"]) {
      const response = await app.request("/api/box" + path, {
        method,
        headers: authorization ? { Authorization: authorization } : {},
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    db.run("UPDATE sessions SET expires_at = ? WHERE token = 'session-1'", [
      new Date(Date.now() - 1000).toISOString(),
    ]);
    expect((await app.request("/api/box" + path, { method, headers })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("reports unavailable configuration across the route set", async () => {
    const disabled = new Hono<AppEnv>().route(
      "/api/box",
      createBoxRoutes(null, createRequireAuth(sqliteQuery(db)))
    );
    for (const [method, path] of [
      ["POST", "/connect"],
      ["GET", "/oauth/callback"],
      ["GET", "/connection"],
      ["DELETE", "/connection"],
    ] as const) {
      expect(
        (await disabled.request("/api/box" + path, { method, headers })).status
      ).toBe(503);
    }
  });

  it("returns a read-only Box authorization URL and a protected browser cookie", async () => {
    const attempt = await start();
    expect(attempt.url.origin + attempt.url.pathname).toBe(
      "https://account.box.com/api/oauth2/authorize"
    );
    expect(Object.fromEntries(attempt.url.searchParams)).toEqual({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: "root_readonly",
      state: attempt.state,
    });
    expect(attempt.url.href).not.toContain("session-1");
    expect(attempt.url.href).not.toContain(config.clientSecret);
    expect(attempt.cookie).toMatch(/^__Host-box_oauth_nonce=[A-Za-z0-9_-]{43}$/);
    for (const attribute of [
      "Secure",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=600",
      "Path=/",
    ]) {
      expect(attempt.setCookie).toContain(attribute);
    }
    expect(attempt.response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(calls).toHaveLength(0);
  });

  it("rejects connect input that could override the destination or requested scope", async () => {
    expect(
      (await app.request("/api/box/connect?scope=write", { method: "POST", headers }))
        .status
    ).toBe(400);
    expect(
      (
        await app.request("/api/box/connect", {
          method: "POST",
          headers,
          body: '{"redirect_uri":"https://other.example"}',
        })
      ).status
    ).toBe(400);
    expect(db.query("SELECT * FROM box_oauth_attempts").all()).toEqual([]);
  });

  it("exchanges a callback without a bearer header and stores only the verified Box identity and encrypted credentials", async () => {
    const attempt = await start();
    const response = await callback(attempt);
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(callbackPath + "?result=connected");
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(calls.map(({ url }) => url)).toEqual([
      "https://api.box.com/oauth2/token",
      "https://api.box.com/2.0/users/me?fields=id",
    ]);
    expect(calls[0]?.form).toEqual({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code,
    });
    expect(new Headers(calls[1]?.init.headers).get("Authorization")).toBe(
      "Bearer " + access
    );
    expect(
      calls.every(
        ({ init }) => init.redirect === "error" && init.signal instanceof AbortSignal
      )
    ).toBe(true);
    const record = await store.getConnection("user-1");
    expect(record?.boxUserId).toBe("123456");
    expect(await store.getActiveTokens("user-1", record?.id ?? "")).toEqual({
      accessToken: access,
      refreshToken: refresh,
    });
    expect(JSON.stringify(db.query("SELECT * FROM box_connections").all())).not.toContain(
      access
    );
    expect(db.query("SELECT * FROM box_oauth_attempts").all()).toEqual([]);
    const status = await app.request("/api/box/connection", { headers });
    expect(await status.json()).toEqual({
      connection: {
        boxUserId: "123456",
        status: "active",
        accessExpiresAt: now + 3600_000,
      },
    });
    const result = await app.request(response.headers.get("Location") ?? "");
    expect(await result.text()).toContain("Box connected.");
    expect(calls).toHaveLength(2);
  });

  it.each([
    "code=",
    "code=a%0Ab",
    "code=" + "x".repeat(2049),
    "code=a&code=b",
    "code=a&state=duplicate",
    "error=access_denied&code=a",
    "error=unknown",
    "result=connected&code=a",
  ])("rejects malformed callback %# before contacting Box", async (params) => {
    expect((await callback(await start(), params)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("rejects callbacks with missing or mismatched cookies and leaves the valid attempt usable", async () => {
    const attempt = await start();
    const different = await start(other);
    expect((await callback({ ...attempt, cookie: "" })).status).toBe(400);
    const bad = await callback({ ...attempt, cookie: different.cookie });
    expect(bad.headers.get("Location")).toBe(callbackPath + "?result=invalid_state");
    expect(bad.headers.get("Set-Cookie")).toBeNull();
    expect(calls).toHaveLength(0);
    expect((await callback(attempt)).headers.get("Location")).toBe(
      callbackPath + "?result=connected"
    );
    expect(await store.getConnection("user-2")).toBeNull();
  });

  it("consumes a denied authorization attempt without exchanging a code or reflecting Box error text", async () => {
    const attempt = await start();
    const response = await callback(
      attempt,
      "error=access_denied&error_description=upstream-secret"
    );
    expect(response.headers.get("Location")).toBe(callbackPath + "?result=denied");
    expect(await response.text()).not.toContain("upstream-secret");
    expect((await callback(attempt)).headers.get("Location")).toBe(
      callbackPath + "?result=invalid_state"
    );
    expect(calls).toHaveLength(0);
  });

  it("permits exactly one code exchange across competing callbacks", async () => {
    const attempt = await start();
    const responses = await Promise.all([callback(attempt), callback(attempt)]);
    expect(responses.map((res) => res.headers.get("Location")).sort()).toEqual([
      callbackPath + "?result=connected",
      callbackPath + "?result=invalid_state",
    ]);
    expect(
      calls.filter(({ form }) => form.grant_type === "authorization_code")
    ).toHaveLength(1);
  });

  it.each(["session deleted", "state expired"])(
    "rejects a callback after %s",
    async (reason) => {
      const attempt = await start();
      if (reason === "session deleted")
        db.run("DELETE FROM sessions WHERE token = 'session-1'");
      else now += 600_000;
      expect((await callback(attempt)).headers.get("Location")).toBe(
        callbackPath + "?result=invalid_state"
      );
      expect(calls).toHaveLength(0);
    }
  );

  it.each(["logout", "disconnect"])(
    "prevents a pending exchange from saving after %s",
    async (operation) => {
      const attempt = await start();
      override = async (url, form) => {
        if (form.grant_type !== "authorization_code") {
          return url.endsWith("/oauth2/revoke")
            ? new Response(null)
            : Response.json({ id: "123456" });
        }
        if (operation === "logout")
          db.run("DELETE FROM sessions WHERE token = 'session-1'");
        else
          expect(
            (await app.request("/api/box/connection", { method: "DELETE", headers }))
              .status
          ).toBe(200);
        return tokenResponse();
      };
      expect((await callback(attempt)).headers.get("Location")).toBe(
        callbackPath + "?result=conflict"
      );
      expect(await store.getConnection("user-1")).toBeNull();
      expect(calls.at(-1)?.form.token).toBe(refresh);
    }
  );

  it("prevents switching Box accounts while preserving the old connection and grants", async () => {
    const old = await seedConnection();
    await store.grantFolder("user-1", old.id, "123");
    override = (url) =>
      url.includes("/users/me") ? Response.json({ id: "999" }) : undefined;
    expect((await callback(await start())).headers.get("Location")).toBe(
      callbackPath + "?result=conflict"
    );
    expect(await store.getFolderConnection("user-1", "123")).toEqual(old);
    expect(calls.at(-1)?.form.token).toBe(refresh);
  });

  it.each([
    [
      400,
      { error: "invalid_grant", error_description: "private provider detail" },
      "invalid_code",
    ],
    [429, { error: "private provider detail" }, "unavailable"],
    [
      200,
      { access_token: access, token_type: "bearer", expires_in: 3600 },
      "unavailable",
    ],
    [
      200,
      {
        access_token: access,
        refresh_token: refresh,
        token_type: "bearer",
        expires_in: -1,
      },
      "unavailable",
    ],
  ] as const)(
    "handles token exchange failures without storing credentials %#",
    async (status, body, outcome) => {
      override = (url) =>
        url.endsWith("/oauth2/token") ? Response.json(body, { status }) : undefined;
      const response = await callback(await start());
      expect(response.headers.get("Location")).toBe(callbackPath + "?result=" + outcome);
      expect(await response.text()).not.toContain("private provider detail");
      expect(await store.getConnection("user-1")).toBeNull();
      expect(calls).toHaveLength(1);
    }
  );

  it("revokes a newly exchanged pair if Box fails to identify its owner", async () => {
    override = (url) =>
      url.includes("/users/me") ? Response.json({ id: 123 }) : undefined;
    expect((await callback(await start())).headers.get("Location")).toBe(
      callbackPath + "?result=unavailable"
    );
    expect(await store.getConnection("user-1")).toBeNull();
    expect(calls.at(-1)?.form.token).toBe(refresh);
  });

  it("reconnects the same Box identity and preserves its folder grants", async () => {
    const previous = await seedConnection();
    await store.grantFolder("user-1", previous.id, "123");
    expect((await callback(await start())).headers.get("Location")).toBe(
      callbackPath + "?result=connected"
    );
    expect(await store.getFolderConnection("user-1", "123")).toMatchObject({
      id: previous.id,
      tokenVersion: 1,
    });
    expect(await store.getActiveTokens("user-1", previous.id)).toEqual({
      accessToken: access,
      refreshToken: refresh,
    });
  });

  it("returns only the caller's connection and rejects a target user parameter", async () => {
    await seedConnection();
    expect(
      await (await app.request("/api/box/connection", { headers: other })).json()
    ).toEqual({ connection: null });
    expect(
      (await app.request("/api/box/connection?userId=user-1", { headers: other })).status
    ).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("rotates expired credentials once across concurrent status requests", async () => {
    const record = await seedConnection(now + 500);
    now += 1000;
    let allowRefresh = () => {};
    const release = new Promise<void>((resolve) => {
      allowRefresh = resolve;
    });
    let refreshStarted = () => {};
    const started = new Promise<void>((resolve) => {
      refreshStarted = resolve;
    });
    override = async (_, form) => {
      expect(form.refresh_token).toBe(TOKENS.refreshToken);
      refreshStarted();
      await release;
      return tokenResponse();
    };
    const first = app.request("/api/box/connection", { headers });
    await started;
    try {
      const concurrent = await app.request("/api/box/connection", { headers });
      expect(await concurrent.json()).toMatchObject({
        connection: { status: "refreshing" },
      });
    } finally {
      allowRefresh();
    }
    expect(await (await first).json()).toEqual({
      connection: {
        boxUserId: record.boxUserId,
        status: "active",
        accessExpiresAt: now + 3600_000,
      },
    });
    expect(calls).toHaveLength(1);
    expect((await store.getConnection("user-1"))?.tokenVersion).toBe(1);
    expect(await store.getActiveTokens("user-1", record.id)).toEqual({
      accessToken: access,
      refreshToken: refresh,
    });
  });

  it.each(["revoked", "timeout", "unrotated"])(
    "requires reconnect after a %s refresh and never retries the old token",
    async (failure) => {
      await seedConnection(now + 1000);
      override = () => {
        if (failure === "timeout") throw new Error("network " + TOKENS.refreshToken);
        if (failure === "unrotated") return tokenResponse(access, TOKENS.refreshToken);
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      };
      for (let count = 0; count < 2; count++) {
        const response = await app.request("/api/box/connection", { headers });
        expect(await response.json()).toEqual({
          connection: {
            boxUserId: "123456",
            status: "reconnect_required",
            accessExpiresAt: null,
          },
        });
      }
      expect(
        calls.filter(({ form }) => form.grant_type === "refresh_token")
      ).toHaveLength(1);
      expect(db.query("SELECT tokens_ciphertext FROM box_connections").get()).toEqual({
        tokens_ciphertext: null,
      });
    }
  );

  it("revokes the replacement token if a refresh completes after disconnect", async () => {
    await seedConnection(now + 1000);
    override = async (url, form) => {
      if (form.grant_type !== "refresh_token") return new Response(null);
      expect(
        (await app.request("/api/box/connection", { method: "DELETE", headers })).status
      ).toBe(200);
      expect(url).toBe("https://api.box.com/oauth2/token");
      return tokenResponse();
    };
    expect(await (await app.request("/api/box/connection", { headers })).json()).toEqual({
      connection: null,
    });
    expect(
      calls
        .filter(({ url }) => url.endsWith("/oauth2/revoke"))
        .map(({ form }) => form.token)
    ).toEqual([TOKENS.refreshToken, refresh]);
    expect(await store.getConnection("user-1")).toBeNull();
  });

  it("clears a connection with unreadable credentials and reports unconfirmed revocation", async () => {
    const record = await seedConnection();
    await store.grantFolder("user-1", record.id, "123");
    db.run("UPDATE box_connections SET tokens_ciphertext = 'v1.damaged' WHERE id = ?", [
      record.id,
    ]);
    expect(
      await (
        await app.request("/api/box/connection", { method: "DELETE", headers })
      ).json()
    ).toEqual({
      disconnected: true,
      revocationConfirmed: false,
    });
    expect(await store.getFolderConnection("user-1", "123")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("returns a sanitized error if the database fails during authentication", async () => {
    const brokenAuth = createRequireAuth(async () => {
      throw new Error("private database response");
    });
    const brokenApp = new Hono<AppEnv>().route(
      "/api/box",
      createBoxRoutes(null, brokenAuth)
    );
    const response = await brokenApp.request("/api/box/connection", { headers });
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Box connection operation failed" });
  });

  it.each([true, false])(
    "disconnects locally regardless of Box revocation confirmation (%s)",
    async (confirmed) => {
      const record = await seedConnection(now + 1000);
      await store.grantFolder("user-1", record.id, "123");
      const pending = await start();
      now += 2000;
      override = (url) =>
        url.endsWith("/oauth2/revoke")
          ? new Response(null, { status: confirmed ? 200 : 503 })
          : undefined;
      expect(
        (
          await app.request("/api/box/connection?userId=user-1", {
            method: "DELETE",
            headers: other,
          })
        ).status
      ).toBe(400);
      expect(
        (
          await app.request("/api/box/connection", {
            method: "DELETE",
            headers: other,
            body: "{}",
          })
        ).status
      ).toBe(400);
      expect(
        await (
          await app.request("/api/box/connection", { method: "DELETE", headers: other })
        ).json()
      ).toEqual({ disconnected: true, revocationConfirmed: true });
      expect(await store.getConnection("user-1")).toEqual(record);
      expect(calls).toHaveLength(0);

      const response = await app.request("/api/box/connection", {
        method: "DELETE",
        headers,
      });
      expect(await response.json()).toEqual({
        disconnected: true,
        revocationConfirmed: confirmed,
      });
      expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe("https://api.box.com/oauth2/revoke");
      expect(calls[0]?.form.token).toBe(TOKENS.refreshToken);
      expect(await store.getConnection("user-1")).toBeNull();
      expect(await store.getFolderConnection("user-1", "123")).toBeNull();
      expect((await callback(pending)).headers.get("Location")).toBe(
        callbackPath + "?result=invalid_state"
      );
    }
  );
});
