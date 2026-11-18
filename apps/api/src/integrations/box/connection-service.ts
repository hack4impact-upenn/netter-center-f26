import { BoxOAuthError, createBoxOAuth } from "./oauth";
import type { BoxConnection, BoxStore } from "./store";

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

/** Owns parent OAuth credentials. Only browser navigation and connection metadata cross this interface. */
export function createBoxConnectionService(
  store: BoxStore,
  oauth: OAuth,
  now = Date.now
) {
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
      const current = await store.getConnection(userId);
      if (!current || current.status === "reconnect_required")
        return publicConnection(current);
      if (
        current.status === "active" &&
        (current.accessExpiresAt ?? 0) > now() + REFRESH_MARGIN_MS
      ) {
        return publicConnection(current);
      }

      const lease = await store.acquireRefresh(userId, current.id, current.tokenVersion);
      if (!lease) return publicConnection(await store.getConnection(userId));

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
      return publicConnection(await store.getConnection(userId));
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
