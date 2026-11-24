import {
  LISTING_WORKER_PATH,
  BoxListingError,
  fetchListing,
  listingJson,
  readFolderPage,
  record,
  retryAfter,
  validListingWorkerSecret,
  type BoxFetch,
  type FolderPageRequest,
} from "./listing-contract";

export function inspectListingWorker(
  env: Record<string, string | undefined> = process.env
) {
  const raw = env.BOX_LISTING_WORKER_URL;
  const secret = env.BOX_LISTING_WORKER_SECRET;
  if (
    env.BOX_LISTING_PERMISSIONS_VERIFIED !== "true" ||
    !raw ||
    !validListingWorkerSecret(secret)
  ) {
    return null;
  }
  try {
    const url = new URL(raw);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      !(
        url.protocol === "https:" ||
        (local && url.protocol === "http:" && env.NODE_ENV !== "production")
      ) ||
      !/^https?:\/\//.test(raw) ||
      /[\s\\?#]/.test(raw) ||
      url.username ||
      url.password ||
      url.pathname !== "/"
    )
      return null;
    return { endpoint: new URL(LISTING_WORKER_PATH, url).href, secret };
  } catch {
    return null;
  }
}

export function createListingWorkerClient(
  config: { endpoint: string; secret: string },
  request: BoxFetch = (url, init) => fetch(url, init)
) {
  return async (input: FolderPageRequest, token: string) => {
    const response = await fetchListing(
      request,
      config.endpoint,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          folderId: input.folderId,
          limit: input.limit,
          marker: input.marker,
          token,
        }),
      },
      20_000
    );
    if (response.ok) return readFolderPage(await listingJson(response), input);
    if (response.status === 401 || response.status === 403)
      throw new BoxListingError("unavailable");
    const { code } = record(await listingJson(response));
    if (
      (response.status === 404 && code === "not_found") ||
      (response.status === 400 && code === "invalid_page") ||
      (response.status === 504 && code === "timeout") ||
      (response.status === 502 && code === "token_rejected")
    )
      throw new BoxListingError(code);
    if (response.status === 503 && code === "rate_limited") {
      throw new BoxListingError(
        "rate_limited",
        retryAfter(response.headers.get("Retry-After"))
      );
    }
    throw new BoxListingError("upstream");
  };
}
