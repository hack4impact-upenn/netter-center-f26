export const LISTING_WORKER_PATH = "/internal/box/list-folder";

export function validListingWorkerSecret(secret: string | undefined): secret is string {
  return typeof secret === "string" && /^[a-f0-9]{64}$/.test(secret);
}

export type FolderPageRequest = { folderId: string; limit: number; marker?: string };
export type FolderPage = {
  folderId: string;
  folderName: string;
  files: {
    id: string;
    name: string;
    createdAt: string | null;
    modifiedAt: string | null;
  }[];
  nextMarker: string | null;
};

const errors = {
  not_found: [404, "Folder not found"],
  reconnect_required: [409, "Reconnect your Box account"],
  refreshing: [503, "Box connection is refreshing"],
  invalid_page: [400, "Invalid Box page marker"],
  rate_limited: [503, "Box is rate limited"],
  timeout: [504, "Box listing timed out"],
  upstream: [502, "Box listing failed"],
  unavailable: [503, "Box listing is unavailable"],
  token_rejected: [502, "Box listing token was rejected"],
} as const;

export class BoxListingError extends Error {
  readonly status: (typeof errors)[keyof typeof errors][0];
  constructor(
    readonly code: keyof typeof errors,
    readonly retryAfter?: string
  ) {
    const [status, message] = errors[code];
    super(message);
    this.status = status;
  }
}

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BoxListingError("upstream");
  }
  return value as Record<string, unknown>;
}

export function isBoxId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,63}$/.test(value);
}

export function isBoxMarker(value: unknown): value is string {
  return typeof value === "string" && /^[\x21-\x7e]{1,2048}$/.test(value);
}

export function isBoxBearer(value: unknown): value is string {
  return typeof value === "string" && /^[\x21-\x7e]{1,16384}$/.test(value);
}

export function readPageRequest(
  folderId: unknown,
  limit: unknown,
  marker: unknown
): FolderPageRequest | null {
  if (
    !isBoxId(folderId) ||
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 1000 ||
    (marker !== undefined && !isBoxMarker(marker))
  )
    return null;
  return { folderId, limit, marker };
}

export function retryAfter(value: string | null): string | undefined {
  return value && /^[0-9]{1,6}$/.test(value) ? value : undefined;
}

function timestamp(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new BoxListingError("upstream");
  return value;
}

export function readFolderPage(value: unknown, request: FolderPageRequest): FolderPage {
  const page = record(value);
  if (
    page.folderId !== request.folderId ||
    typeof page.folderName !== "string" ||
    !page.folderName ||
    !Array.isArray(page.files) ||
    page.files.length > request.limit ||
    (page.nextMarker !== null && !isBoxMarker(page.nextMarker)) ||
    page.nextMarker === request.marker
  )
    throw new BoxListingError("upstream");
  const files = page.files.map((value) => {
    const file = record(value);
    if (!isBoxId(file.id) || typeof file.name !== "string" || !file.name) {
      throw new BoxListingError("upstream");
    }
    return {
      id: file.id,
      name: file.name,
      createdAt: timestamp(file.createdAt),
      modifiedAt: timestamp(file.modifiedAt),
    };
  });
  return {
    folderId: request.folderId,
    folderName: page.folderName,
    files,
    nextMarker: page.nextMarker,
  };
}

export type BoxFetch = (url: string, init: RequestInit) => Promise<Response>;

export async function fetchListing(
  request: BoxFetch,
  url: string,
  init: RequestInit,
  timeout: number
) {
  const signal = AbortSignal.timeout(timeout);
  try {
    return await request(url, { ...init, signal, redirect: "error" });
  } catch (error) {
    const timedOut =
      signal.aborted || (error instanceof Error && error.name === "TimeoutError");
    throw new BoxListingError(timedOut ? "timeout" : "upstream");
  }
}

export async function listingJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new BoxListingError(
      error instanceof Error && error.name === "TimeoutError" ? "timeout" : "upstream"
    );
  }
}

export function readRestrictedFolderToken(
  value: unknown,
  parentToken: string,
  folderId: string
): string {
  const data = record(value);
  const restrictions = data.restricted_to;
  if (
    !isBoxBearer(data.access_token) ||
    data.access_token === parentToken ||
    data.token_type !== "bearer" ||
    data.refresh_token != null ||
    typeof data.expires_in !== "number" ||
    !Number.isSafeInteger(data.expires_in) ||
    data.expires_in <= 0 ||
    !Array.isArray(restrictions) ||
    restrictions.length !== 1
  )
    throw new BoxListingError("upstream");

  const restriction = record(restrictions[0]);
  const object = record(restriction.object);
  if (
    restriction.scope !== "base_explorer" ||
    object.type !== "folder" ||
    object.id !== folderId
  ) {
    throw new BoxListingError("upstream");
  }
  return data.access_token;
}
