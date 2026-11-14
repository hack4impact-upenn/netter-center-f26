import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { NOW, openDatabase, schema, seedUsers } from "./fixtures";

describe("Box authorization schema on SQLite", () => {
  let db: Database;
  beforeEach(() => {
    db = openDatabase();
    seedUsers(db);
  });
  afterEach(() => {
    db.close();
  });

  function insertConnection() {
    db.run(
      `INSERT INTO box_connections
      (id, user_id, box_user_id, status, tokens_ciphertext, access_expires_at, created_at, updated_at)
      VALUES ('connection-1', 'user-1', '123', 'active', 'v1.synthetic', ?, ?, ?)`,
      [NOW + 1000, NOW, NOW]
    );
  }

  function insertAttempt(userId = "user-1", session = "session-1", ttl = 600_000) {
    db.run(
      `INSERT INTO box_oauth_attempts
      (state_hash, browser_nonce_hash, user_id, session_token, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)`,
      ["a".repeat(64), "b".repeat(64), userId, session, NOW, NOW + ttl]
    );
  }

  it("upgrades the original schema and can be reapplied without losing users or sessions", () => {
    const legacy = new Database(":memory:");
    try {
      legacy.exec("PRAGMA foreign_keys = ON");
      legacy.exec(schema.split("-- Supports a composite")[0] ?? "");
      seedUsers(legacy);
      legacy.exec(schema);
      legacy.exec(schema);
      expect(legacy.query("SELECT id FROM users ORDER BY id").all()).toEqual([
        { id: "user-1" },
        { id: "user-2" },
      ]);
      expect(legacy.query("SELECT token FROM sessions ORDER BY token").all()).toEqual([
        { token: "session-1" },
        { token: "session-2" },
      ]);
      expect(legacy.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      legacy.close();
    }
  });

  it("enforces one Box connection per application user", () => {
    insertConnection();
    expect(() =>
      db.run(
        `INSERT INTO box_connections
      (id, user_id, box_user_id, status, tokens_ciphertext, access_expires_at, created_at, updated_at)
      VALUES ('connection-2', 'user-1', '456', 'active', 'v1.synthetic', ?, ?, ?)`,
        [NOW + 1000, NOW, NOW]
      )
    ).toThrow("UNIQUE");
  });

  it("rejects orphan connections", () => {
    expect(() =>
      db.run(
        `INSERT INTO box_connections
      (id, user_id, box_user_id, status, created_at, updated_at)
      VALUES ('connection-1', 'missing-user', '123', 'reconnect_required', ?, ?)`,
        [NOW, NOW]
      )
    ).toThrow("FOREIGN KEY");
  });

  it("binds an OAuth attempt's application user to the owning session", () => {
    expect(() => insertAttempt("user-2", "session-1")).toThrow("FOREIGN KEY");
    expect(() => insertAttempt("user-1", "missing-session")).toThrow("FOREIGN KEY");
    insertAttempt();
    expect(db.query("SELECT user_id FROM box_oauth_attempts").all()).toEqual([
      { user_id: "user-1" },
    ]);
  });

  it.each([0, -1, 600_001])("rejects invalid OAuth attempt lifetime %i", (ttl) => {
    expect(() => insertAttempt("user-1", "session-1", ttl)).toThrow("CHECK");
  });

  it("rejects raw state values in place of hashes", () => {
    insertAttempt();
    expect(() =>
      db.run("UPDATE box_oauth_attempts SET state_hash = 'raw-state-secret'")
    ).toThrow("CHECK");
    expect(() =>
      db.run("UPDATE box_oauth_attempts SET browser_nonce_hash = ?", ["G".repeat(64)])
    ).toThrow("CHECK");
  });

  it("blocks cross-user folder grants at the database boundary", () => {
    insertConnection();
    expect(() =>
      db.run(
        `INSERT INTO box_folder_access (user_id, box_folder_id, connection_id, created_at)
      VALUES ('user-2', '999', 'connection-1', ?)`,
        [NOW]
      )
    ).toThrow("FOREIGN KEY");
    db.run(
      `INSERT INTO box_folder_access (user_id, box_folder_id, connection_id, created_at)
      VALUES ('user-1', '999', 'connection-1', ?)`,
      [NOW]
    );
    expect(() =>
      db.run(
        `INSERT INTO box_folder_access (user_id, box_folder_id, connection_id, created_at)
      VALUES ('user-1', '999', 'connection-1', ?)`,
        [NOW]
      )
    ).toThrow("UNIQUE");
  });

  it.each(["0", "-1", "folder", "1/2", "1.5", "1".repeat(65)])(
    "rejects malformed Box IDs %#",
    (id) => {
      insertConnection();
      expect(() => db.run("UPDATE box_connections SET box_user_id = ?", [id])).toThrow(
        "CHECK"
      );
      expect(() =>
        db.run(
          "INSERT INTO box_folder_access (user_id, box_folder_id, connection_id, created_at) VALUES ('user-1', ?, 'connection-1', ?)",
          [id, NOW]
        )
      ).toThrow("CHECK");
    }
  );

  it.each([
    "status = 'unknown'",
    "status = 'refreshing'",
    "status = 'reconnect_required'",
    "tokens_ciphertext = NULL",
    "tokens_ciphertext = 'plaintext-token'",
    "access_expires_at = NULL",
    "token_version = -1",
    "token_version = 0.5",
    "refresh_lock_id = 'unexpected-lock'",
    "updated_at = created_at - 1",
  ])("rejects inconsistent credential state %#", (assignment) => {
    insertConnection();
    expect(() => db.exec(`UPDATE box_connections SET ${assignment}`)).toThrow("CHECK");
  });

  it("deletes OAuth attempts when the initiating session is logged out", () => {
    insertAttempt();
    db.run("DELETE FROM sessions WHERE token = 'session-1'");
    expect(db.query("SELECT * FROM box_oauth_attempts").all()).toEqual([]);
    expect(db.query("SELECT token FROM sessions").all()).toEqual([
      { token: "session-2" },
    ]);
  });

  it("cascades user deletion through sessions, attempts, connections and grants", () => {
    insertAttempt();
    insertConnection();
    db.run(
      "INSERT INTO box_folder_access (user_id, box_folder_id, connection_id, created_at) VALUES ('user-1', '999', 'connection-1', ?)",
      [NOW]
    );
    db.run("DELETE FROM users WHERE id = 'user-1'");
    for (const table of ["box_oauth_attempts", "box_connections", "box_folder_access"]) {
      expect(db.query(`SELECT * FROM ${table}`).all()).toEqual([]);
    }
    expect(db.query("SELECT token FROM sessions").all()).toEqual([
      { token: "session-2" },
    ]);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
