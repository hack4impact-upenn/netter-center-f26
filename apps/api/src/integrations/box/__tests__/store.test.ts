import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoxStore, type BoxQuery } from "../store";
import { KEY, NOW, TOKENS, openDatabase, seedUsers, sqliteQuery } from "./fixtures";

function present<T>(value: T | null): T {
  if (value === null) throw new Error("Expected a successful fixture operation");
  return value;
}

describe("Box credential and authorization persistence", () => {
  let db: Database;
  let store: BoxStore;
  let now: number;

  beforeEach(() => {
    db = openDatabase();
    seedUsers(db);
    now = NOW;
    store = new BoxStore({ encryptionKey: KEY, query: sqliteQuery(db), now: () => now });
  });
  afterEach(() => {
    db.close();
  });

  async function connect(userId = "user-1", boxUserId = "123") {
    return present(
      await store.saveConnection({
        userId,
        boxUserId,
        tokens: TOKENS,
        accessExpiresAt: now + 3_600_000,
      })
    );
  }

  it("stores an encrypted pair and returns only connection metadata", async () => {
    expect(await store.getConnection("user-1")).toBeNull();
    const result = await connect();
    expect(result).toEqual({
      id: expect.any(String),
      userId: "user-1",
      boxUserId: "123",
      status: "active",
      accessExpiresAt: NOW + 3_600_000,
      tokenVersion: 0,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(await store.getConnection("user-1")).toEqual(result);
    expect(await store.getActiveTokens("user-1", result.id)).toEqual(TOKENS);
    const persisted = JSON.stringify(db.query("SELECT * FROM box_connections").all());
    expect(persisted).toContain("v1.");
    expect(persisted).not.toContain(TOKENS.accessToken);
    expect(persisted).not.toContain(TOKENS.refreshToken);
    expect(JSON.stringify(result)).not.toContain("tokens_ciphertext");
  });

  it("takes its own copy of the encryption key", async () => {
    const key = Uint8Array.from(KEY);
    const independent = new BoxStore({
      encryptionKey: key,
      query: sqliteQuery(db),
      now: () => now,
    });
    key.fill(0);
    const record = present(
      await independent.saveConnection({
        userId: "user-1",
        boxUserId: "123",
        tokens: TOKENS,
        accessExpiresAt: now + 1000,
      })
    );
    expect(await store.getActiveTokens("user-1", record.id)).toEqual(TOKENS);
  });

  it("rejects invalid encryption keys before using the database", () => {
    expect(() => new BoxStore({ encryptionKey: new Uint8Array(31) })).toThrow(
      "32-byte key"
    );
  });

  it.each([NOW, NOW - 1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid access-token expiry %#",
    async (accessExpiresAt) => {
      await expect(
        store.saveConnection({
          userId: "user-1",
          boxUserId: "123",
          tokens: TOKENS,
          accessExpiresAt,
        })
      ).rejects.toThrow("expiry");
      expect(await store.getConnection("user-1")).toBeNull();
    }
  );

  it("requires valid user and token values before persisting a connection", async () => {
    await expect(
      store.saveConnection({
        userId: "",
        boxUserId: "123",
        tokens: TOKENS,
        accessExpiresAt: NOW + 1000,
      })
    ).rejects.toThrow("application user ID");
    await expect(
      store.saveConnection({
        userId: "user-1",
        boxUserId: "../123",
        tokens: TOKENS,
        accessExpiresAt: NOW + 1000,
      })
    ).rejects.toThrow("Invalid Box");
    await expect(
      store.saveConnection({
        userId: "user-1",
        boxUserId: "123",
        tokens: { ...TOKENS, refreshToken: "" },
        accessExpiresAt: NOW + 1000,
      })
    ).rejects.toThrow("Invalid Box token pair");
    expect(await store.getConnection("user-1")).toBeNull();
  });

  it("prevents cross-user token reads, grants and disconnects", async () => {
    const record = await connect();
    expect(await store.getConnection("user-2")).toBeNull();
    expect(await store.getActiveTokens("user-2", record.id)).toBeNull();
    expect(await store.grantFolder("user-2", record.id, "999")).toBe(false);
    expect(await store.disconnect("user-2", record.id)).toBe(false);
    expect(await store.getConnection("user-1")).toEqual(record);
  });

  it("authorizes only exact granted folders and allows explicit revocation", async () => {
    const one = await connect();
    const two = await connect("user-2", "456");
    expect(await store.getFolderConnection("user-1", "999")).toBeNull();
    expect(await store.grantFolder("user-1", one.id, "999")).toBe(true);
    expect(await store.grantFolder("user-1", one.id, "999")).toBe(false);
    expect(await store.getFolderConnection("user-1", "999")).toEqual(one);
    expect(await store.getFolderConnection("user-1", "9990")).toBeNull();
    expect(await store.getFolderConnection("user-2", "999")).toBeNull();
    expect(await store.grantFolder("user-2", two.id, "999")).toBe(true);
    expect(await store.getFolderConnection("user-2", "999")).toEqual(two);
    expect(await store.revokeFolder("user-1", "999")).toBe(true);
    expect(await store.revokeFolder("user-1", "999")).toBe(false);
    expect(await store.getFolderConnection("user-1", "999")).toBeNull();
    expect(await store.getFolderConnection("user-2", "999")).toEqual(two);
  });

  it("parameterizes application identities instead of interpolating them into SQL", async () => {
    const record = await connect();
    await store.grantFolder("user-1", record.id, "999");
    const malicious = "' OR 1=1 --";
    expect(await store.getConnection(malicious)).toBeNull();
    expect(await store.getFolderConnection(malicious, "999")).toBeNull();
    expect(await store.disconnect(malicious, record.id)).toBe(false);
    expect(await store.getActiveTokens(malicious, record.id)).toBeNull();
  });

  it("validates folder IDs before authorization queries", async () => {
    const record = await connect();
    for (const id of ["0", "../123", "123?fields=shared_link"]) {
      await expect(store.grantFolder("user-1", record.id, id)).rejects.toThrow(
        "Invalid Box"
      );
      await expect(store.getFolderConnection("user-1", id)).rejects.toThrow(
        "Invalid Box"
      );
      await expect(store.revokeFolder("user-1", id)).rejects.toThrow("Invalid Box");
    }
  });

  it("removes grants when a connection is disconnected", async () => {
    const record = await connect();
    await store.grantFolder("user-1", record.id, "999");
    expect(await store.disconnect("user-1", record.id)).toBe(true);
    expect(await store.disconnect("user-1", record.id)).toBe(false);
    expect(await store.getFolderConnection("user-1", "999")).toBeNull();
    expect(await store.getActiveTokens("user-1", record.id)).toBeNull();
  });

  it("preserves grants on same-account reconnection and increments the credential version", async () => {
    const original = await connect();
    await store.grantFolder("user-1", original.id, "999");
    now += 1000;
    const tokens = {
      accessToken: "reconnected-access",
      refreshToken: "reconnected-refresh",
    };
    const updated = present(
      await store.saveConnection({
        userId: "user-1",
        boxUserId: "123",
        tokens,
        accessExpiresAt: now + 5000,
      })
    );
    expect(updated.id).toBe(original.id);
    expect(updated.createdAt).toBe(original.createdAt);
    expect(updated.updatedAt).toBe(now);
    expect(updated.tokenVersion).toBe(1);
    expect(await store.getActiveTokens("user-1", original.id)).toEqual(tokens);
    expect(await store.getFolderConnection("user-1", "999")).toEqual(updated);
  });

  it("requires disconnect before changing Box account, preventing inherited grants", async () => {
    const original = await connect();
    await store.grantFolder("user-1", original.id, "999");
    expect(
      await store.saveConnection({
        userId: "user-1",
        boxUserId: "456",
        tokens: TOKENS,
        accessExpiresAt: now + 1000,
      })
    ).toBeNull();
    expect(await store.getConnection("user-1")).toEqual(original);
    await store.disconnect("user-1", original.id);
    const replacement = await connect("user-1", "456");
    expect(replacement.id).not.toBe(original.id);
    expect(await store.getFolderConnection("user-1", "999")).toBeNull();
  });

  it("suppresses database errors containing bound secrets", async () => {
    const broken = new BoxStore({
      encryptionKey: KEY,
      query: async () => {
        throw new Error(`upstream SQL failure with ${TOKENS.accessToken} and session-1`);
      },
    });
    await expect(broken.getConnection("user-1")).rejects.toThrow(
      "Box persistence operation failed"
    );
    try {
      await broken.createOAuthAttempt("user-1", "session-1");
    } catch (error) {
      expect(String(error)).not.toContain(TOKENS.accessToken);
      expect(String(error)).not.toContain("session-1");
    }
  });

  describe("OAuth attempts", () => {
    it("generates independent random state and nonce, persisting only their hashes", async () => {
      const first = present(await store.createOAuthAttempt("user-1", "session-1"));
      const second = present(await store.createOAuthAttempt("user-1", "session-1"));
      expect(first.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(first.browserNonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(first.state).not.toBe(first.browserNonce);
      expect(first.state).not.toBe(second.state);
      expect(first.expiresAt).toBe(NOW + 600_000);
      const persisted = JSON.stringify(
        db.query("SELECT * FROM box_oauth_attempts").all()
      );
      expect(persisted).not.toContain(first.state);
      expect(persisted).not.toContain(first.browserNonce);
    });

    it("requires a live session belonging to the initiating user", async () => {
      expect(await store.createOAuthAttempt("user-2", "session-1")).toBeNull();
      expect(await store.createOAuthAttempt("user-1", "missing-session")).toBeNull();
      db.run("UPDATE sessions SET expires_at = ? WHERE token = 'session-1'", [
        new Date(now).toISOString(),
      ]);
      expect(await store.createOAuthAttempt("user-1", "session-1")).toBeNull();
      expect(db.query("SELECT * FROM box_oauth_attempts").all()).toEqual([]);
    });

    it("accepts legacy SQLite datetime session expiries", async () => {
      db.run(
        "UPDATE sessions SET expires_at = '2026-11-15 12:00:00' WHERE token = 'session-1'"
      );
      const attempt = present(await store.createOAuthAttempt("user-1", "session-1"));
      expect(
        await store.claimOAuthAttempt(attempt.state, attempt.browserNonce)
      ).toMatchObject({ userId: "user-1" });
    });

    it("consumes an attempt once, including competing callbacks", async () => {
      const attempt = present(await store.createOAuthAttempt("user-1", "session-1"));
      const results = await Promise.all([
        store.claimOAuthAttempt(attempt.state, attempt.browserNonce),
        store.claimOAuthAttempt(attempt.state, attempt.browserNonce),
      ]);
      expect(results.filter(Boolean)).toMatchObject([{ userId: "user-1" }]);
      expect(
        await store.claimOAuthAttempt(attempt.state, attempt.browserNonce)
      ).toBeNull();
    });

    it("requires the matching browser nonce without burning a legitimate attempt", async () => {
      const first = present(await store.createOAuthAttempt("user-1", "session-1"));
      const second = present(await store.createOAuthAttempt("user-2", "session-2"));
      expect(await store.claimOAuthAttempt(first.state, second.browserNonce)).toBeNull();
      expect(
        await store.claimOAuthAttempt(first.state, first.browserNonce)
      ).toMatchObject({
        userId: "user-1",
      });
    });

    it("rejects expiration at the exact deadline and cleans up expired attempts on creation", async () => {
      const attempt = present(await store.createOAuthAttempt("user-1", "session-1"));
      now = attempt.expiresAt;
      expect(
        await store.claimOAuthAttempt(attempt.state, attempt.browserNonce)
      ).toBeNull();
      await store.createOAuthAttempt("user-1", "session-1");
      expect(db.query("SELECT created_at FROM box_oauth_attempts").all()).toEqual([
        { created_at: now },
      ]);
    });

    it.each(["expired", "logged out"])(
      "rejects callbacks after the initiating session is %s",
      async (condition) => {
        const attempt = present(await store.createOAuthAttempt("user-1", "session-1"));
        if (condition === "expired")
          db.run("UPDATE sessions SET expires_at = ? WHERE token = 'session-1'", [
            new Date(now - 1).toISOString(),
          ]);
        else db.run("DELETE FROM sessions WHERE token = 'session-1'");
        expect(
          await store.claimOAuthAttempt(attempt.state, attempt.browserNonce)
        ).toBeNull();
      }
    );

    it("returns null for malformed callback inputs", async () => {
      expect(await store.claimOAuthAttempt("bad-state", "bad-nonce")).toBeNull();
      await expect(store.createOAuthAttempt("user-1", "")).rejects.toThrow(
        "session token"
      );
    });
  });

  describe("refresh ownership and rotation", () => {
    it.each([false, true])(
      "recovers safely when a refresh persistence response is lost, write applied = %s",
      async (writeApplied) => {
        const record = await connect();
        const lease = present(await store.acquireRefresh("user-1", record.id, 0));
        const baseQuery = sqliteQuery(db);
        const interrupted = new BoxStore({
          encryptionKey: KEY,
          now: () => now,
          query: async <T>(sql: string, params?: unknown[]) => {
            if (sql.startsWith("UPDATE box_connections SET status = 'active'")) {
              if (writeApplied) await baseQuery<T>(sql, params);
              throw new Error("Lost response after persistence request");
            }
            return baseQuery<T>(sql, params);
          },
        });
        const rotated = {
          accessToken: "persisted-access",
          refreshToken: "persisted-refresh",
        };
        await expect(
          interrupted.completeRefresh(lease, rotated, now + 5000)
        ).rejects.toThrow("Box persistence operation failed");
        expect(await store.failRefresh(lease)).toBe(!writeApplied);
        expect(await store.getActiveTokens("user-1", record.id)).toEqual(
          writeApplied ? rotated : null
        );
        expect((await store.getConnection("user-1"))?.status).toBe(
          writeApplied ? "active" : "reconnect_required"
        );
      }
    );

    it("allows exactly one lease and persists both replacement tokens atomically", async () => {
      const record = await connect();
      now = record.accessExpiresAt ?? 0;
      expect(await store.getActiveTokens("user-1", record.id)).toBeNull();
      const results = await Promise.all([
        store.acquireRefresh("user-1", record.id, 0),
        store.acquireRefresh("user-1", record.id, 0),
      ]);
      const lease = present(results.find((result) => result !== null) ?? null);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(lease.tokens).toEqual(TOKENS);
      expect(await store.getActiveTokens("user-1", record.id)).toBeNull();
      const rotated = { accessToken: "new-access", refreshToken: "new-refresh" };
      expect(await store.completeRefresh(lease, rotated, now + 5000)).toBe(true);
      expect(await store.completeRefresh(lease, rotated, now + 5000)).toBe(false);
      expect(await store.getActiveTokens("user-1", record.id)).toEqual(rotated);
      expect((await store.getConnection("user-1"))?.tokenVersion).toBe(1);
      expect(await store.acquireRefresh("user-1", record.id, 0)).toBeNull();
    });

    it("enforces owner and expected version before handing out refresh tokens", async () => {
      const record = await connect();
      expect(await store.acquireRefresh("user-2", record.id, 0)).toBeNull();
      expect(await store.acquireRefresh("user-1", record.id, 99)).toBeNull();
      await expect(store.acquireRefresh("user-1", record.id, -1)).rejects.toThrow(
        "token version"
      );
      expect((await store.getConnection("user-1"))?.status).toBe("active");
    });

    it("rejects forged lease identity, lock and version without modifying credentials", async () => {
      const record = await connect();
      const lease = present(await store.acquireRefresh("user-1", record.id, 0));
      for (const forged of [
        { ...lease, userId: "user-2" },
        { ...lease, connectionId: "missing" },
        { ...lease, boxUserId: "456" },
        { ...lease, tokenVersion: 1 },
        { ...lease, lockId: "wrong-lock" },
      ]) {
        expect(await store.completeRefresh(forged, TOKENS, now + 5000)).toBe(false);
        expect(await store.failRefresh(forged)).toBe(false);
      }
      expect((await store.getConnection("user-1"))?.status).toBe("refreshing");
      expect(await store.completeRefresh(lease, TOKENS, now + 5000)).toBe(true);
    });

    it("clears tokens after an uncertain outcome and requires reconnection", async () => {
      const record = await connect();
      await store.grantFolder("user-1", record.id, "999");
      const lease = present(await store.acquireRefresh("user-1", record.id, 0));
      expect(await store.failRefresh(lease)).toBe(true);
      expect(await store.failRefresh(lease)).toBe(false);
      expect(await store.getActiveTokens("user-1", record.id)).toBeNull();
      expect(await store.acquireRefresh("user-1", record.id, 1)).toBeNull();
      expect(await store.completeRefresh(lease, TOKENS, now + 5000)).toBe(false);
      expect(
        db
          .query(
            "SELECT tokens_ciphertext, access_expires_at, refresh_lock_id FROM box_connections"
          )
          .get()
      ).toEqual({
        tokens_ciphertext: null,
        access_expires_at: null,
        refresh_lock_id: null,
      });
      expect((await store.getFolderConnection("user-1", "999"))?.status).toBe(
        "reconnect_required"
      );
      expect(await store.grantFolder("user-1", record.id, "888")).toBe(false);
      expect((await connect()).status).toBe("active");
      expect((await store.getFolderConnection("user-1", "999"))?.status).toBe("active");
    });

    it("never reuses a single-use token after a lease expires", async () => {
      const record = await connect();
      const lease = present(await store.acquireRefresh("user-1", record.id, 0));
      now = lease.expiresAt;
      expect(await store.completeRefresh(lease, TOKENS, now + 5000)).toBe(false);
      expect(await store.acquireRefresh("user-2", record.id, 0)).toBeNull();
      expect((await store.getConnection("user-1"))?.status).toBe("refreshing");
      expect(await store.acquireRefresh("user-1", record.id, 0)).toBeNull();
      expect((await store.getConnection("user-1"))?.status).toBe("reconnect_required");
      expect(await store.getActiveTokens("user-1", record.id)).toBeNull();
      expect(await store.completeRefresh(lease, TOKENS, now + 5000)).toBe(false);
    });

    it("fences old workers when a user reconnects during refresh", async () => {
      const record = await connect();
      const lease = present(await store.acquireRefresh("user-1", record.id, 0));
      const updated = await connect();
      expect(updated.tokenVersion).toBe(1);
      expect(
        await store.completeRefresh(
          lease,
          { accessToken: "late-access", refreshToken: "late-refresh" },
          now + 5000
        )
      ).toBe(false);
      expect(await store.failRefresh(lease)).toBe(false);
      expect(await store.getActiveTokens("user-1", record.id)).toEqual(TOKENS);
    });

    it("does not resurrect a disconnected connection from a late refresh", async () => {
      const record = await connect();
      const lease = present(await store.acquireRefresh("user-1", record.id, 0));
      await store.disconnect("user-1", record.id);
      expect(await store.completeRefresh(lease, TOKENS, now + 5000)).toBe(false);
      expect(await store.failRefresh(lease)).toBe(false);
      expect(await store.getConnection("user-1")).toBeNull();
    });

    it("keeps the old pair intact when replacement tokens fail validation", async () => {
      const record = await connect();
      const lease = present(await store.acquireRefresh("user-1", record.id, 0));
      await expect(
        store.completeRefresh(
          lease,
          { accessToken: "replacement", refreshToken: "" },
          now + 5000
        )
      ).rejects.toThrow("Invalid Box token pair");
      await expect(store.completeRefresh(lease, TOKENS, now)).rejects.toThrow("expiry");
      expect((await store.getConnection("user-1"))?.status).toBe("refreshing");
      expect(await store.completeRefresh(lease, TOKENS, now + 5000)).toBe(true);
    });

    it("rejects swapped ciphertext and invalidates a refresh with undecryptable tokens", async () => {
      const one = await connect();
      await connect("user-2", "456");
      db.run(
        "UPDATE box_connections SET tokens_ciphertext = (SELECT tokens_ciphertext FROM box_connections WHERE user_id = 'user-2') WHERE user_id = 'user-1'"
      );
      await expect(store.getActiveTokens("user-1", one.id)).rejects.toThrow(
        "Unable to decrypt Box tokens"
      );
      await expect(store.acquireRefresh("user-1", one.id, 0)).rejects.toThrow(
        "Unable to decrypt Box tokens"
      );
      expect((await store.getConnection("user-1"))?.status).toBe("reconnect_required");
      expect(await store.acquireRefresh("user-1", one.id, 1)).toBeNull();
    });
  });
});

describe("independent SQLite clients", () => {
  let directory: string;
  let firstDb: Database;
  let secondDb: Database;
  let first: BoxStore;
  let second: BoxStore;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "box-store-tests-"));
    const filename = join(directory, "authorization.sqlite");
    firstDb = openDatabase(filename);
    firstDb.exec("PRAGMA journal_mode = WAL");
    seedUsers(firstDb);
    secondDb = openDatabase(filename);
    first = new BoxStore({
      encryptionKey: KEY,
      query: sqliteQuery(firstDb),
      now: () => NOW,
    });
    second = new BoxStore({
      encryptionKey: KEY,
      query: sqliteQuery(secondDb),
      now: () => NOW,
    });
  });
  afterEach(() => {
    firstDb.close();
    secondDb.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const input = {
    userId: "user-1",
    boxUserId: "123",
    tokens: TOKENS,
    accessExpiresAt: NOW + 3_600_000,
  };

  it("allows only one initial connection when two clients race", async () => {
    const results = await Promise.all([
      first.saveConnection(input),
      second.saveConnection(input),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const record = present(await first.getConnection("user-1"));
    expect(await second.getActiveTokens("user-1", record.id)).toEqual(TOKENS);
  });

  it("allows only one credential replacement for a previously read version", async () => {
    await first.saveConnection(input);
    const firstPair = { accessToken: "first-access", refreshToken: "first-refresh" };
    const secondPair = { accessToken: "second-access", refreshToken: "second-refresh" };
    const results = await Promise.all([
      first.saveConnection({ ...input, tokens: firstPair }),
      second.saveConnection({ ...input, tokens: secondPair }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = present(results[0] ?? results[1] ?? null);
    expect(winner.tokenVersion).toBe(1);
    expect(await first.getActiveTokens("user-1", winner.id)).toEqual(
      results[0] ? firstPair : secondPair
    );
  });

  it("uses database ownership for refresh and callback replay across clients", async () => {
    const record = present(await first.saveConnection(input));
    const leases = await Promise.all([
      first.acquireRefresh("user-1", record.id, 0),
      second.acquireRefresh("user-1", record.id, 0),
    ]);
    expect(leases.filter(Boolean)).toHaveLength(1);
    const attempt = present(await first.createOAuthAttempt("user-1", "session-1"));
    const callbacks = await Promise.all([
      first.claimOAuthAttempt(attempt.state, attempt.browserNonce),
      second.claimOAuthAttempt(attempt.state, attempt.browserNonce),
    ]);
    expect(callbacks.filter(Boolean)).toMatchObject([{ userId: "user-1" }]);
  });

  it("does not recreate credentials if a disconnect races a reconnection update", async () => {
    const record = present(await first.saveConnection(input));
    const sql = sqliteQuery(firstDb);
    let disconnected = false;
    const interleaved: BoxQuery = async <T>(statement: string, params?: unknown[]) => {
      const rows = await sql<T>(statement, params);
      if (!disconnected && statement.startsWith("SELECT * FROM box_connections")) {
        disconnected = true;
        await second.disconnect("user-1", record.id);
      }
      return rows;
    };
    const racing = new BoxStore({
      encryptionKey: KEY,
      query: interleaved,
      now: () => NOW,
    });
    expect(await racing.saveConnection(input)).toBeNull();
    expect(await second.getConnection("user-1")).toBeNull();
  });
});
