import { BoxOAuthError, createBoxOAuth } from "./oauth";
import type { BoxConnection, BoxStore } from "./store";
import { BoxListingError } from "./listing-contract";

type OAuth = ReturnType<typeof createBoxOAuth>;
const REFRESH_MARGIN_MS = 60_000;

function publicConnection(connection: BoxConnection | null) {
  if (!connection) return null;
  return {
    boxUserId: connection.boxUserId,
    status: connection.status,
    accessExpiresAt: connection.accessExpiresAt,
  };
}

/** Owns parent OAuth credentials. The listing interface releases only folder-restricted tokens. */
export function createBoxConnectionService(
  store: BoxStore,
  oauth: OAuth,
  now = Date.now
) {
  async function refreshConnection(current: BoxConnection | null, force = false) {
    if (!current) return null;
    const { userId } = current;
    if (current.status === "reconnect_required") return current;
    if (
      !force &&
      current.status === "active" &&
      (current.accessExpiresAt ?? 0) > now() + REFRESH_MARGIN_MS
    ) {
      return current;
    }

    const lease = await store.acquireRefresh(userId, current.id, current.tokenVersion);
    if (!lease) return store.getConnection(userId);

    let rotated;
    try {
      rotated = await oauth.refresh(lease.tokens.refreshToken);
      // A refresh credential that Box didn't rotate cannot be used again.
      if (rotated.tokens.refreshToken === lease.tokens.refreshToken) {
        throw new BoxOAuthError("unavailable");
      }
      if (
        !(await store.completeRefresh(lease, rotated.tokens, rotated.accessExpiresAt))
      ) {
        await store.failRefresh(lease);
        await oauth.revoke(rotated.tokens.refreshToken);
      }
    } catch (error) {
      const cleared = await store.failRefresh(lease);
      if (cleared && rotated) await oauth.revoke(rotated.tokens.refreshToken);
      if (!(error instanceof BoxOAuthError)) throw error;
    }
    return store.getConnection(userId);
  }

  return {
    async start(userId: string, sessionToken: string) {
      const attempt = await store.createOAuthAttempt(userId, sessionToken);
      if (!attempt) return null;
      return {
        authorizationUrl: oauth.authorizationUrl(attempt.state),
        browserNonce: attempt.browserNonce,
      };
    },
    async finish(state: string, browserNonce: string, code: string | null) {
      const attempt = await store.claimOAuthAttempt(state, browserNonce);
      if (!attempt) return "invalid_state";
      const { userId, claim } = attempt;
      try {
        if (code === null) return "denied";
        const grant = await oauth.exchange(code);
        const boxUserId = await oauth
          .userId(grant.tokens.accessToken)
          .catch(async (error) => {
            await oauth.revoke(grant.tokens.refreshToken);
            throw error;
          });
        // If the write throws, it may already have committed. Avoid revoking
        // the new pair until we know that the database rejected it.
        const saved = await store.saveConnection({ userId, boxUserId, ...grant }, claim);
        if (!saved) {
          await oauth.revoke(grant.tokens.refreshToken);
          return "conflict";
        }
        return "connected";
      } catch (error) {
        if (error instanceof BoxOAuthError) {
          return error.reason === "invalid_grant" ? "invalid_code" : "unavailable";
        }
        throw error;
      } finally {
        // The browser state was spent when claimed. A failed cleanup expires on its own.
        await store.discardOAuthClaim(userId, claim).catch(() => {});
      }
    },
    async status(userId: string) {
      return publicConnection(await refreshConnection(await store.getConnection(userId)));
    },
    async folderListingToken(userId: string, folderId: string) {
      async function granted() {
        const connection = await store.getFolderConnection(userId, folderId);
        if (!connection) throw new BoxListingError("not_found");
        return connection;
      }
      async function mint(connection: BoxConnection) {
        if (connection.status === "refreshing") throw new BoxListingError("refreshing");
        if (connection.status !== "active")
          throw new BoxListingError("reconnect_required");
        const pair = await store.getActiveTokens(
          userId,
          connection.id,
          connection.tokenVersion
        );
        if (!pair) throw new BoxListingError("refreshing");
        const token = await oauth.downscopeFolder(pair.accessToken, folderId);
        const latest = await granted();
        if (
          latest.id !== connection.id ||
          latest.tokenVersion !== connection.tokenVersion ||
          latest.status !== "active"
        )
          throw new BoxListingError("refreshing");
        return token;
      }

      const original = await granted();
      await refreshConnection(original);
      const current = await granted();
      try {
        return await mint(current);
      } catch (error) {
        if (!(error instanceof BoxListingError) || error.code !== "token_rejected")
          throw error;
        // Refresh the parent at most once when Box rejects its authorization.
        const latest = await granted();
        if (latest.id === current.id && latest.tokenVersion === current.tokenVersion) {
          await refreshConnection(latest, true);
        }
        try {
          return await mint(await granted());
        } catch (retryError) {
          if (
            retryError instanceof BoxListingError &&
            retryError.code === "token_rejected"
          ) {
            throw new BoxListingError("reconnect_required");
          }
          throw retryError;
        }
      }
    },
    async disconnect(userId: string) {
      const removed = await store.disconnectUser(userId);
      const revocationConfirmed =
        !removed ||
        (removed.tokens !== null && (await oauth.revoke(removed.tokens.refreshToken)));
      return { disconnected: true, revocationConfirmed };
    },
  };
}
