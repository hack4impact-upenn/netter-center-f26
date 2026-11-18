import { timingSafeEqual } from "node:crypto";
import { readBoxFolderMetadata } from "./folder-metadata";
import {
  LISTING_WORKER_PATH,
  BoxListingError,
  isBoxBearer,
  readFolderPage,
  readPageRequest,
  record,
  type BoxFetch,
  type FolderPageRequest,
} from "./listing-contract";

async function listBoxFolder(
  input: FolderPageRequest,
  token: string,
  request?: BoxFetch
) {
  const metadata = await readBoxFolderMetadata(input, token, request);
  const files = [];
  for (const value of metadata.entries) {
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
      folderId: input.folderId,
      folderName: metadata.folderName,
      files,
      nextMarker: metadata.nextMarker,
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
