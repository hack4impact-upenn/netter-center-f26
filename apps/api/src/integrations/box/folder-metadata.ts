import {
  BoxListingError,
  fetchListing,
  listingJson,
  record,
  retryAfter,
  type BoxFetch,
  type FolderPageRequest,
} from "./listing-contract";

const BOX_API = "https://api.box.com/2.0/folders";

export async function readBoxFolderMetadata(
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

  return {
    folderName: folder.name,
    entries: page.entries as unknown[],
    nextMarker: page.next_marker ?? null,
  };
}
