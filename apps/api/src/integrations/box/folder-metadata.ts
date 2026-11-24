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

async function getFolderData(
  request: BoxFetch,
  url: string,
  token: string,
  hasMarker = false
) {
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

export async function readBoxFolderItems(
  input: FolderPageRequest,
  token: string,
  request: BoxFetch = (url, init) => fetch(url, init)
) {
  const params = new URLSearchParams({
    fields: "id,type,name,created_at,modified_at",
    usemarker: "true",
    limit: String(input.limit),
  });
  if (input.marker !== undefined) params.set("marker", input.marker);
  const page = await getFolderData(
    request,
    `${BOX_API}/${input.folderId}/items?${params}`,
    token,
    input.marker !== undefined
  );
  if (!Array.isArray(page.entries) || page.entries.length > input.limit) {
    throw new BoxListingError("upstream");
  }

  return {
    entries: page.entries as unknown[],
    nextMarker: page.next_marker ?? null,
  };
}

export async function readBoxFolderMetadata(
  input: FolderPageRequest,
  token: string,
  request: BoxFetch = (url, init) => fetch(url, init)
) {
  // Resolve the folder before asking for its children.
  const folder = await getFolderData(
    request,
    `${BOX_API}/${input.folderId}?fields=id,name`,
    token
  );
  if (folder.id !== input.folderId || typeof folder.name !== "string" || !folder.name) {
    throw new BoxListingError("upstream");
  }
  return {
    folderName: folder.name,
    ...(await readBoxFolderItems(input, token, request)),
  };
}
