import {
  fetchListing,
  isBoxId,
  listingJson,
  record,
  type BoxFetch,
} from "./listing-contract";

export const FOLDER_CREATION_RESULTS = {
  201: "Created",
  400: "Box rejected the folder name",
  401: "Box session expired. Sign in again",
  403: "Box denied write access to this folder",
  404: "Box could not find this parent folder",
  409: "Name already in use",
  502: "Box did not confirm creation. Check the folder before retrying",
  503: "Box is rate limiting creation. Try again later",
} as const;

export type FolderCreationResult =
  | { status: 201; id: string }
  | { status: Exclude<keyof typeof FOLDER_CREATION_RESULTS, 201> };

export async function createBoxFolder(
  parentId: string,
  name: string,
  token: string,
  request: BoxFetch = (url, init) => fetch(url, init)
): Promise<FolderCreationResult> {
  try {
    const response = await fetchListing(
      request,
      "https://api.box.com/2.0/folders?fields=id,type,name,parent",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ name, parent: { id: parentId } }),
      },
      8000
    );
    const { status } = response;
    if (status !== 201) {
      await response.body?.cancel().catch(() => {});
      if (
        status === 400 ||
        status === 401 ||
        status === 403 ||
        status === 404 ||
        status === 409
      ) {
        return { status };
      }
      return { status: status === 429 ? 503 : 502 };
    }
    const folder = record(await listingJson(response));
    if (
      folder.type === "folder" &&
      folder.name === name &&
      isBoxId(folder.id) &&
      record(folder.parent).id === parentId
    ) {
      return { status: 201, id: folder.id };
    }
  } catch {
    // A failed network request can still have created the folder in Box.
  }
  return { status: 502 };
}
