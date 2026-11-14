import { Database, type SQLQueryBindings } from "bun:sqlite";
import { readFileSync } from "node:fs";

export const schema = readFileSync(
  new URL("../../../schema.sql", import.meta.url),
  "utf8"
);
export const NOW = Date.parse("2026-11-14T12:00:00.000Z");
export const KEY = new Uint8Array(32).fill(17);
export const TOKENS = {
  accessToken: "fixture-access-token",
  refreshToken: "fixture-refresh-token",
};

export function openDatabase(filename = ":memory:") {
  const db = new Database(filename);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(schema);
  return db;
}

export function sqliteQuery(db: Database) {
  return async <T>(sql: string, params: unknown[] = []) =>
    db.query<T, SQLQueryBindings[]>(sql).all(...(params as SQLQueryBindings[]));
}

export function seedUsers(db: Database) {
  db.run(
    "INSERT INTO users (id, email, password_hash) VALUES ('user-1', 'one@example.test', 'hash'), ('user-2', 'two@example.test', 'hash')"
  );
  db.run(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, 'user-1', ?), (?, 'user-2', ?)",
    [
      "session-1",
      new Date(NOW + 86_400_000).toISOString(),
      "session-2",
      new Date(NOW + 86_400_000).toISOString(),
    ]
  );
}
