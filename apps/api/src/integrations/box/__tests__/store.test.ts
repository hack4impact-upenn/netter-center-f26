import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoxStore } from "../store";
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

    it("accepts legacy SQLite datetime session expiries", async () => {
      db.run(
        "UPDATE sessions SET expires_at = '2026-11-15 12:00:00' WHERE token = 'session-1'"
      );
      const attempt = present(await store.createOAuthAttempt("user-1", "session-1"));
      expect(
        await store.claimOAuthAttempt(attempt.state, attempt.browserNonce)
      ).toMatchObject({ userId: "user-1" });
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
});
