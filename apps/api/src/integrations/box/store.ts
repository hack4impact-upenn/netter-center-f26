import { createHash, randomBytes, randomUUID } from "node:crypto";
import { query as databaseQuery } from "../database";
import {
  decryptBoxTokens,
  encryptBoxTokens,
  type BoxTokenContext,
  type BoxTokenPair,
} from "./tokens";

export type BoxQuery = <T>(sql: string, params?: unknown[]) => Promise<T[]>;

export type BoxConnection = {
  id: string;
  userId: string;
  boxUserId: string;
  status: "active" | "refreshing" | "reconnect_required";
  accessExpiresAt: number | null;
  tokenVersion: number;
  createdAt: number;
  updatedAt: number;
};

type ConnectionRow = {
  id: string;
  user_id: string;
  box_user_id: string;
  status: BoxConnection["status"];
  access_expires_at: number | null;
  token_version: number;
  tokens_ciphertext: string | null;
  refresh_lock_id: string | null;
  refresh_expires_at: number | null;
  created_at: number;
  updated_at: number;
};

export type BoxRefreshLease = BoxTokenContext & {
  lockId: string;
  expiresAt: number;
  tokens: BoxTokenPair;
};

const OAUTH_TTL_MS = 10 * 60 * 1000;
const REFRESH_LEASE_MS = 2 * 60 * 1000;
const OAUTH_SECRET = /^[A-Za-z0-9_-]{43}$/;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requireId(value: string, name: string): void {
  if (!value || value.length > 256 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`Invalid Box ${name}`);
  }
}

function requireBoxId(value: string): void {
  if (!/^[1-9]\d{0,63}$/.test(value)) throw new Error("Invalid Box item or user ID");
}

function connection(row: ConnectionRow): BoxConnection {
  return {
    id: row.id,
    userId: row.user_id,
    boxUserId: row.box_user_id,
    status: row.status,
    accessExpiresAt: row.access_expires_at,
    tokenVersion: row.token_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function tokenContext(row: ConnectionRow): BoxTokenContext {
  return {
    connectionId: row.id,
    userId: row.user_id,
    boxUserId: row.box_user_id,
    tokenVersion: row.token_version,
  };
}

/** Private credential persistence. Instantiate only inside the credential component. */
export class BoxStore {
  private readonly key: Uint8Array;
  private readonly query: BoxQuery;
  private readonly now: () => number;

  constructor(options: {
    encryptionKey: Uint8Array;
    query?: BoxQuery;
    now?: () => number;
  }) {
    if (options.encryptionKey.byteLength !== 32) {
      throw new Error("Box token encryption requires a 32-byte key");
    }
    this.key = Uint8Array.from(options.encryptionKey);
    this.query = options.query ?? databaseQuery;
    this.now = options.now ?? Date.now;
  }

  private async run<T>(sql: string, params: unknown[]): Promise<T[]> {
    try {
      return await this.query<T>(sql, params);
    } catch {
      // D1 error bodies can include SQL or bound secrets, especially session tokens.
      throw new Error("Box persistence operation failed");
    }
  }

  private requireFutureExpiry(expiresAt: number, now: number): void {
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
      throw new Error(
        "Box access token expiry must be a future Unix millisecond timestamp"
      );
    }
  }

  async createOAuthAttempt(userId: string, sessionToken: string) {
    requireId(userId, "application user ID");
    requireId(sessionToken, "session token");
    const now = this.now();
    const state = randomBytes(32).toString("base64url");
    const browserNonce = randomBytes(32).toString("base64url");
    const expiresAt = now + OAUTH_TTL_MS;
    await this.run("DELETE FROM box_oauth_attempts WHERE expires_at <= ?", [now]);
    const rows = await this.run<{ state_hash: string }>(
      `INSERT INTO box_oauth_attempts
        (state_hash, browser_nonce_hash, user_id, session_token, created_at, expires_at)
       SELECT ?, ?, user_id, token, ?, ? FROM sessions
       WHERE token = ? AND user_id = ? AND julianday(expires_at) > julianday(?)
       RETURNING state_hash`,
      [
        hash(state),
        hash(browserNonce),
        now,
        expiresAt,
        sessionToken,
        userId,
        new Date(now).toISOString(),
      ]
    );
    return rows.length ? { state, browserNonce, expiresAt } : null;
  }

  async claimOAuthAttempt(
    state: string,
    browserNonce: string
  ): Promise<{ userId: string; claim: string } | null> {
    if (!OAUTH_SECRET.test(state) || !OAUTH_SECRET.test(browserNonce)) return null;
    const now = this.now();
    // Swap the browser-facing state for an internal claim. The remaining row
    // can still be cancelled while the callback is waiting on Box.
    const claim = randomBytes(32).toString("base64url");
    const rows = await this.run<{ user_id: string }>(
      `UPDATE box_oauth_attempts SET state_hash = ?
       WHERE state_hash = ? AND browser_nonce_hash = ? AND expires_at > ?
         AND EXISTS (SELECT 1 FROM sessions s
           WHERE s.token = box_oauth_attempts.session_token
             AND s.user_id = box_oauth_attempts.user_id
             AND julianday(s.expires_at) > julianday(?))
       RETURNING user_id`,
      [hash(claim), hash(state), hash(browserNonce), now, new Date(now).toISOString()]
    );
    return rows[0] ? { userId: rows[0].user_id, claim } : null;
  }

  async discardOAuthClaim(userId: string, claim: string): Promise<void> {
    await this.run(
      "DELETE FROM box_oauth_attempts WHERE user_id = ? AND state_hash = ?",
      [userId, hash(claim)]
    );
  }

  async getConnection(userId: string): Promise<BoxConnection | null> {
    const rows = await this.run<ConnectionRow>(
      "SELECT * FROM box_connections WHERE user_id = ?",
      [userId]
    );
    return rows[0] ? connection(rows[0]) : null;
  }

  /** Reconnection preserves grants only for the same Box account. Conflicts return null. */
  async saveConnection(
    input: {
      userId: string;
      boxUserId: string;
      tokens: BoxTokenPair;
      accessExpiresAt: number;
    },
    oauthClaim?: string
  ): Promise<BoxConnection | null> {
    requireId(input.userId, "application user ID");
    requireBoxId(input.boxUserId);
    const existing = await this.getConnection(input.userId);
    if (existing && existing.boxUserId !== input.boxUserId) return null;
    const now = this.now();
    this.requireFutureExpiry(input.accessExpiresAt, now);
    const id = existing?.id ?? randomUUID();
    const version = existing ? existing.tokenVersion + 1 : 0;
    const claimCondition =
      oauthClaim === undefined
        ? "1"
        : `EXISTS (
      SELECT 1 FROM box_oauth_attempts a JOIN sessions s
        ON s.token = a.session_token AND s.user_id = a.user_id
      WHERE a.user_id = ? AND a.state_hash = ? AND a.expires_at > ?
        AND julianday(s.expires_at) > julianday(?)
    )`;
    const claimParams =
      oauthClaim === undefined
        ? []
        : [input.userId, hash(oauthClaim), now, new Date(now).toISOString()];
    const encrypted = encryptBoxTokens(input.tokens, this.key, {
      connectionId: id,
      userId: input.userId,
      boxUserId: input.boxUserId,
      tokenVersion: version,
    });
    if (existing) {
      const rows = await this.run<ConnectionRow>(
        `UPDATE box_connections SET status = 'active', tokens_ciphertext = ?,
           access_expires_at = ?, token_version = token_version + 1,
           refresh_lock_id = NULL, refresh_expires_at = NULL, updated_at = ?
         WHERE id = ? AND user_id = ? AND box_user_id = ? AND token_version = ?
           AND ${claimCondition}
         RETURNING *`,
        [
          encrypted,
          input.accessExpiresAt,
          now,
          id,
          input.userId,
          input.boxUserId,
          existing.tokenVersion,
          ...claimParams,
        ]
      );
      return rows[0] ? connection(rows[0]) : null;
    }
    const rows = await this.run<ConnectionRow>(
      `INSERT INTO box_connections
         (id, user_id, box_user_id, status, tokens_ciphertext, access_expires_at,
          token_version, created_at, updated_at)
       SELECT ?, ?, ?, 'active', ?, ?, 0, ?, ? WHERE ${claimCondition}
       ON CONFLICT(user_id) DO NOTHING
       RETURNING *`,
      [
        id,
        input.userId,
        input.boxUserId,
        encrypted,
        input.accessExpiresAt,
        now,
        now,
        ...claimParams,
      ]
    );
    return rows[0] ? connection(rows[0]) : null;
  }

  async disconnect(userId: string, connectionId: string): Promise<boolean> {
    const rows = await this.run<{ id: string }>(
      "DELETE FROM box_connections WHERE id = ? AND user_id = ? RETURNING id",
      [connectionId, userId]
    );
    return rows.length === 1;
  }

  /** Remove local authority first and return the deleted pair for remote revocation. */
  async disconnectUser(userId: string): Promise<{ tokens: BoxTokenPair | null } | null> {
    await this.run("DELETE FROM box_oauth_attempts WHERE user_id = ?", [userId]);
    const [row] = await this.run<ConnectionRow>(
      "DELETE FROM box_connections WHERE user_id = ? RETURNING *",
      [userId]
    );
    if (!row) return null;
    if (!row.tokens_ciphertext) return { tokens: null };
    try {
      return {
        tokens: decryptBoxTokens(row.tokens_ciphertext, this.key, tokenContext(row)),
      };
    } catch {
      return { tokens: null };
    }
  }

  /** Trusted provisioning only. A user may use only their own Box connection. */
  async grantFolder(
    userId: string,
    connectionId: string,
    folderId: string
  ): Promise<boolean> {
    requireBoxId(folderId);
    const rows = await this.run<{ box_folder_id: string }>(
      `INSERT INTO box_folder_access (user_id, box_folder_id, connection_id, created_at)
       SELECT user_id, ?, id, ? FROM box_connections
       WHERE id = ? AND user_id = ? AND status IN ('active', 'refreshing')
       ON CONFLICT(user_id, box_folder_id) DO NOTHING RETURNING box_folder_id`,
      [folderId, this.now(), connectionId, userId]
    );
    return rows.length === 1;
  }

  async revokeFolder(userId: string, folderId: string): Promise<boolean> {
    requireBoxId(folderId);
    const rows = await this.run<{ box_folder_id: string }>(
      "DELETE FROM box_folder_access WHERE user_id = ? AND box_folder_id = ? RETURNING box_folder_id",
      [userId, folderId]
    );
    return rows.length === 1;
  }

  async getFolderConnection(
    userId: string,
    folderId: string
  ): Promise<BoxConnection | null> {
    requireBoxId(folderId);
    const rows = await this.run<ConnectionRow>(
      `SELECT c.* FROM box_connections c JOIN box_folder_access f
         ON f.connection_id = c.id AND f.user_id = c.user_id
       WHERE f.user_id = ? AND f.box_folder_id = ?`,
      [userId, folderId]
    );
    return rows[0] ? connection(rows[0]) : null;
  }

  async getActiveTokens(
    userId: string,
    connectionId: string
  ): Promise<BoxTokenPair | null> {
    const rows = await this.run<ConnectionRow>(
      `SELECT * FROM box_connections
       WHERE id = ? AND user_id = ? AND status = 'active' AND access_expires_at > ?`,
      [connectionId, userId, this.now()]
    );
    const row = rows[0];
    return row?.tokens_ciphertext
      ? decryptBoxTokens(row.tokens_ciphertext, this.key, tokenContext(row))
      : null;
  }

  async acquireRefresh(
    userId: string,
    connectionId: string,
    expectedVersion: number
  ): Promise<BoxRefreshLease | null> {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      throw new Error("Invalid Box token version");
    }
    const now = this.now();
    // An expired lease may already have consumed the single-use refresh token.
    // Clear it instead of letting another worker retry with that same token.
    await this.run(
      `UPDATE box_connections SET status = 'reconnect_required', tokens_ciphertext = NULL,
         access_expires_at = NULL, refresh_lock_id = NULL, refresh_expires_at = NULL,
         token_version = token_version + 1, updated_at = ?
       WHERE id = ? AND user_id = ? AND status = 'refreshing' AND refresh_expires_at <= ?`,
      [now, connectionId, userId, now]
    );
    const lockId = randomUUID();
    const rows = await this.run<ConnectionRow>(
      `UPDATE box_connections SET status = 'refreshing', refresh_lock_id = ?,
         refresh_expires_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND token_version = ? AND status = 'active'
       RETURNING *`,
      [lockId, now + REFRESH_LEASE_MS, now, connectionId, userId, expectedVersion]
    );
    const row = rows[0];
    if (!row?.tokens_ciphertext) return null;
    const context = tokenContext(row);
    try {
      return {
        ...context,
        lockId,
        expiresAt: now + REFRESH_LEASE_MS,
        tokens: decryptBoxTokens(row.tokens_ciphertext, this.key, context),
      };
    } catch {
      await this.failRefresh({ ...context, lockId });
      throw new Error("Unable to decrypt Box tokens");
    }
  }

  async completeRefresh(
    lease: BoxTokenContext & { lockId: string },
    tokens: BoxTokenPair,
    accessExpiresAt: number
  ): Promise<boolean> {
    const now = this.now();
    this.requireFutureExpiry(accessExpiresAt, now);
    const encrypted = encryptBoxTokens(tokens, this.key, {
      ...lease,
      tokenVersion: lease.tokenVersion + 1,
    });
    const rows = await this.run<{ id: string }>(
      `UPDATE box_connections SET status = 'active', tokens_ciphertext = ?,
         access_expires_at = ?, token_version = token_version + 1,
         refresh_lock_id = NULL, refresh_expires_at = NULL, updated_at = ?
       WHERE id = ? AND user_id = ? AND box_user_id = ? AND token_version = ?
         AND status = 'refreshing' AND refresh_lock_id = ? AND refresh_expires_at > ?
       RETURNING id`,
      [
        encrypted,
        accessExpiresAt,
        now,
        lease.connectionId,
        lease.userId,
        lease.boxUserId,
        lease.tokenVersion,
        lease.lockId,
        now,
      ]
    );
    return rows.length === 1;
  }

  /** Use after an uncertain refresh outcome as well as an explicit rejection. */
  async failRefresh(lease: BoxTokenContext & { lockId: string }): Promise<boolean> {
    const rows = await this.run<{ id: string }>(
      `UPDATE box_connections SET status = 'reconnect_required', tokens_ciphertext = NULL,
         access_expires_at = NULL, token_version = token_version + 1,
         refresh_lock_id = NULL, refresh_expires_at = NULL, updated_at = ?
       WHERE id = ? AND user_id = ? AND box_user_id = ? AND token_version = ?
         AND status = 'refreshing' AND refresh_lock_id = ? RETURNING id`,
      [
        this.now(),
        lease.connectionId,
        lease.userId,
        lease.boxUserId,
        lease.tokenVersion,
        lease.lockId,
      ]
    );
    return rows.length === 1;
  }
}
