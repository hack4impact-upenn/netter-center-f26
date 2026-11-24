import {
  BoxListingError,
  fetchListing,
  isBoxId,
  listingJson,
  readRestrictedFolderToken,
  retryAfter,
} from "./listing-contract";
import type { BoxOAuthConfig } from "./config";
import { validateBoxTokens, type BoxTokenPair } from "./tokens";

type RequestBox = (url: string, init: RequestInit) => Promise<Response>;
type TokenGrant = { tokens: BoxTokenPair; accessExpiresAt: number };

const BOX_API = "https://api.box.com";

export class BoxOAuthError extends Error {
  constructor(readonly reason: "invalid_grant" | "unavailable") {
    super("Box OAuth request failed");
  }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BoxOAuthError("unavailable");
  }
  return value as Record<string, unknown>;
}

export function createBoxOAuth(
  config: Pick<BoxOAuthConfig, "clientId" | "clientSecret" | "redirectUri">,
  request: RequestBox = (url, init) => fetch(url, init),
  now = Date.now
) {
  async function call(path: string, init: RequestInit) {
    try {
      return await request(`${BOX_API}${path}`, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new BoxOAuthError("unavailable");
    }
  }

  async function json(response: Response) {
    try {
      return object(await response.json());
    } catch {
      throw new BoxOAuthError("unavailable");
    }
  }

  function post(
    path: "/oauth2/token" | "/oauth2/revoke",
    params: Record<string, string>
  ) {
    return call(path, {
      method: "POST",
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        ...params,
      }),
    });
  }

  async function grant(params: Record<string, string>): Promise<TokenGrant> {
    const startedAt = now();
    const response = await post("/oauth2/token", params);
    if (!response.ok) {
      if (response.status === 400 && (await json(response)).error === "invalid_grant") {
        throw new BoxOAuthError("invalid_grant");
      }
      throw new BoxOAuthError("unavailable");
    }

    const data = await json(response);
    const tokens = { accessToken: data.access_token, refreshToken: data.refresh_token };
    try {
      validateBoxTokens(tokens);
    } catch {
      throw new BoxOAuthError("unavailable");
    }
    const expiresIn = data.expires_in;
    if (
      data.token_type !== "bearer" ||
      typeof expiresIn !== "number" ||
      !Number.isSafeInteger(expiresIn) ||
      expiresIn <= 0 ||
      !Number.isSafeInteger(startedAt + expiresIn * 1000)
    ) {
      throw new BoxOAuthError("unavailable");
    }
    return { tokens, accessExpiresAt: startedAt + expiresIn * 1000 };
  }

  return {
    authorizationUrl(
      state: string,
      scope: "root_readonly" | "root_readonly root_readwrite" = "root_readonly"
    ) {
      const url = new URL("https://account.box.com/api/oauth2/authorize");
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        scope,
        state,
      }).toString();
      return url.href;
    },
    exchange(code: string) {
      return grant({ grant_type: "authorization_code", code });
    },
    refresh(refreshToken: string) {
      return grant({ grant_type: "refresh_token", refresh_token: refreshToken });
    },
    async userId(accessToken: string) {
      const response = await call("/2.0/users/me?fields=id", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new BoxOAuthError("unavailable");
      const { id } = await json(response);
      if (typeof id !== "string" || !/^[1-9]\d{0,63}$/.test(id)) {
        throw new BoxOAuthError("unavailable");
      }
      return id;
    },
    async downscopeFolder(parentToken: string, folderId: string): Promise<string> {
      if (!isBoxId(folderId)) throw new BoxListingError("not_found");
      const response = await fetchListing(
        request,
        `${BOX_API}/oauth2/token`,
        {
          method: "POST",
          body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
            subject_token: parentToken,
            subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
            scope: "base_explorer",
            resource: `${BOX_API}/2.0/folders/${folderId}`,
          }),
        },
        8000
      );
      if (!response.ok) {
        const status = response.status;
        await response.body?.cancel().catch(() => {});
        if (status === 403 || status === 404) throw new BoxListingError("not_found");
        if (status === 401) throw new BoxListingError("token_rejected");
        if (status === 429)
          throw new BoxListingError(
            "rate_limited",
            retryAfter(response.headers.get("Retry-After"))
          );
        throw new BoxListingError("upstream");
      }
      return readRestrictedFolderToken(
        await listingJson(response),
        parentToken,
        folderId
      );
    },
    async revoke(refreshToken: string): Promise<boolean> {
      try {
        return (await post("/oauth2/revoke", { token: refreshToken })).ok;
      } catch {
        return false;
      }
    },
  };
}
