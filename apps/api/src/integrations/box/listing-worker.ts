import { timingSafeEqual } from "node:crypto";
import {
  LISTING_WORKER_PATH,
  BoxListingError,
  fetchListing,
  isBoxBearer,
  listingJson,
  readFolderPage,
  readPageRequest,
  record,
  retryAfter,
  type BoxFetch,
  type FolderPageRequest,
} from "./listing-contract";

const BOX_API = "https://api.box.com/2.0/folders";

export async function listBoxFolder(
  input: FolderPageRequest,
  token: string,
  request: BoxFetch = (url, init) => fetch(url, init)
) {
  const base = `${BOX_API}/${input.folderId}`;
  const params = new URLSearchParams({
    fields: "id,type,name,created_at,modified_at",
    usemarker: "true",
    limit: String(input.limit),
  });
  if (input.marker !== undefined) params.set("marker", input.marker);

  async function get(url: string, hasMarker = false) {
    const response = await fetchListing(
      request,
      url,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      },
      8000
    );

    if (!response.ok) {
      const status = response.status;
      await response.body?.cancel().catch(() => {});
      if (hasMarker && status === 400) throw new BoxListingError("invalid_page");
      if (status === 403 || status === 404) throw new BoxListingError("not_found");
      if (status === 401) throw new BoxListingError("token_rejected");
      if (status === 429)
        throw new BoxListingError(
          "rate_limited",
          retryAfter(response.headers.get("Retry-After"))
        );
      throw new BoxListingError("upstream");
    }
    return record(await listingJson(response));
  }

  // Resolve the folder before asking for its children.
  const folder = await get(`${base}?fields=id,name`);
  if (folder.id !== input.folderId || typeof folder.name !== "string" || !folder.name) {
    throw new BoxListingError("upstream");
  }
  const page = await get(`${base}/items?${params}`, input.marker !== undefined);
  if (!Array.isArray(page.entries) || page.entries.length > input.limit) {
    throw new BoxListingError("upstream");
  }

  const files = [];
  for (const value of page.entries) {
    const entry = record(value);
    if (entry.type === "folder" || entry.type === "web_link") continue;
    if (entry.type !== "file") throw new BoxListingError("upstream");
    files.push({
      id: entry.id,
      name: entry.name,
      createdAt: entry.created_at,
      modifiedAt: entry.modified_at,
    });
  }
  return readFolderPage(
    {
      folderId: folder.id,
      folderName: folder.name,
      files,
      nextMarker: page.next_marker === undefined ? null : page.next_marker,
    },
    input
  );
}

/** The worker has a single authenticated operation and receives only a downscoped token. */
export function createListingWorker(secret: string, request?: BoxFetch) {
  const expected = Buffer.from(`Bearer ${secret}`);
  const headers = { "Cache-Control": "no-store" };
  return async (incoming: Request): Promise<Response> => {
    const url = new URL(incoming.url);
    if (
      incoming.method !== "POST" ||
      url.pathname !== LISTING_WORKER_PATH ||
      url.search
    ) {
      return new Response(null, { status: 404, headers });
    }
    const actual = Buffer.from(incoming.headers.get("Authorization") ?? "");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return new Response(null, { status: 401, headers });
    }
    let input: FolderPageRequest | null;
    let token: unknown;
    try {
      const body = record(await incoming.json());
      if (
        Object.keys(body).some(
          (key) => !["folderId", "limit", "marker", "token"].includes(key)
        )
      ) {
        return new Response(null, { status: 400, headers });
      }
      input = readPageRequest(body.folderId, body.limit, body.marker);
      token = body.token;
    } catch {
      return new Response(null, { status: 400, headers });
    }
    if (!input || !isBoxBearer(token))
      return new Response(null, { status: 400, headers });

    try {
      return Response.json(await listBoxFolder(input, token, request), { headers });
    } catch (error) {
      if (!(error instanceof BoxListingError))
        return new Response(null, { status: 502, headers });
      const responseHeaders = new Headers(headers);
      if (error.retryAfter) responseHeaders.set("Retry-After", error.retryAfter);
      return Response.json(
        { code: error.code },
        { status: error.status, headers: responseHeaders }
      );
    }
  };
}
