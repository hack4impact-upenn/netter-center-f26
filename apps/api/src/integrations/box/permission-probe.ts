const BOX_API = "https://api.box.com";
const NUMERIC_ID = /^[1-9]\d{0,63}$/;

export type ProbeRequest = (url: string, init: RequestInit) => Promise<Response>;

export type PermissionProbeInput = {
  // User-authorized parent token, used only by this explicit developer probe.
  accessToken: string;
  folderId: string;
  fileId: string;
  outsideFolderId: string;
  confirmSyntheticFixtures: boolean;
};

export type PermissionCheck = {
  check: string;
  status: "passed" | "failed" | "inconclusive";
};

export type PermissionProbeResult = {
  verified: boolean;
  checks: PermissionCheck[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel();
}

function hasPreviewCapability(value: unknown): boolean {
  if (!isObject(value)) return false;
  const embed = value.expiring_embed_link;
  const representations = value.representations;
  return (
    isObject(embed) &&
    typeof embed.url === "string" &&
    embed.url.length > 0 &&
    isObject(representations) &&
    Array.isArray(representations.entries) &&
    representations.entries.length > 0
  );
}

/**
 * Opt-in experiment against synthetic fixtures, never a public route.
 * It requires positive controls before it interprets 403/404 as a restriction.
 * Requests never follow redirects, and content bodies are cancelled, not read.
 * No tokens, file names, upstream bodies, or capability URLs leave this function.
 */
export async function verifyBoxPermissions(
  input: PermissionProbeInput,
  request: ProbeRequest = (url, init) => fetch(url, init)
): Promise<PermissionProbeResult> {
  if (!input.confirmSyntheticFixtures) {
    throw new Error(
      "Permission probe requires explicit confirmation of synthetic fixtures"
    );
  }
  for (const name of ["folderId", "fileId", "outsideFolderId"] as const) {
    if (!NUMERIC_ID.test(input[name]))
      throw new Error(`Invalid ${name} for permission probe`);
  }
  if (input.folderId === input.outsideFolderId) {
    throw new Error("Outside folder must differ from the fixture folder");
  }
  if (!input.accessToken || /\s/.test(input.accessToken)) {
    throw new Error("Permission probe requires a user-authorized access token");
  }

  const checks: PermissionCheck[] = [];
  const call = (path: string, token: string, init: RequestInit = {}) =>
    request(`${BOX_API}${path}`, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
  const stop = (check: string, status: "failed" | "inconclusive") => {
    checks.push({ check, status });
    return { verified: false, checks };
  };
  let currentCheck = "fixture metadata positive control";

  try {
    const file = await call(
      `/2.0/files/${input.fileId}?fields=id,type,parent,representations,expiring_embed_link`,
      input.accessToken,
      { headers: { "X-Rep-Hints": "[pdf]" } }
    );
    if (file.status !== 200) {
      await discard(file);
      return stop(currentCheck, "inconclusive");
    }
    const metadata: unknown = await file.json();
    if (
      !isObject(metadata) ||
      metadata.id !== input.fileId ||
      metadata.type !== "file" ||
      !isObject(metadata.parent) ||
      metadata.parent.id !== input.folderId ||
      !hasPreviewCapability(metadata)
    ) {
      return stop(currentCheck, "inconclusive");
    }
    checks.push({ check: currentCheck, status: "passed" });

    const contentPaths = [
      { check: "download denied", path: `/2.0/files/${input.fileId}/content` },
      { check: "thumbnail denied", path: `/2.0/files/${input.fileId}/thumbnail.png` },
    ];
    for (const item of contentPaths) {
      currentCheck = `${item.check} positive control`;
      const response = await call(item.path, input.accessToken);
      const available = response.status === 200 || response.status === 302;
      await discard(response);
      if (!available) return stop(currentCheck, "inconclusive");
      checks.push({ check: currentCheck, status: "passed" });
    }

    currentCheck = "outside folder positive control";
    const outsidePath = `/2.0/folders/${input.outsideFolderId}/items?fields=id,type,name&limit=1`;
    const outside = await call(outsidePath, input.accessToken);
    if (outside.status !== 200) {
      await discard(outside);
      return stop(currentCheck, "inconclusive");
    }
    const outsideBody: unknown = await outside.json();
    if (!isObject(outsideBody) || !Array.isArray(outsideBody.entries)) {
      return stop(currentCheck, "inconclusive");
    }
    checks.push({ check: currentCheck, status: "passed" });

    currentCheck = "folder token exchange";
    const exchange = await call("/oauth2/token", input.accessToken, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: input.accessToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
        scope: "base_explorer",
        resource: `${BOX_API}/2.0/folders/${input.folderId}`,
      }),
    });
    if (exchange.status !== 200) {
      await discard(exchange);
      return stop(currentCheck, "inconclusive");
    }
    const tokenBody: unknown = await exchange.json();
    if (
      !isObject(tokenBody) ||
      typeof tokenBody.access_token !== "string" ||
      !tokenBody.access_token ||
      /\s/.test(tokenBody.access_token) ||
      tokenBody.access_token === input.accessToken ||
      tokenBody.token_type !== "bearer" ||
      !Array.isArray(tokenBody.restricted_to) ||
      tokenBody.restricted_to.length !== 1
    ) {
      return stop(currentCheck, "inconclusive");
    }
    const restriction: unknown = tokenBody.restricted_to[0];
    if (
      !isObject(restriction) ||
      restriction.scope !== "base_explorer" ||
      !isObject(restriction.object) ||
      restriction.object.type !== "folder" ||
      restriction.object.id !== input.folderId
    ) {
      return stop(currentCheck, "failed");
    }
    const token = tokenBody.access_token;
    checks.push({ check: currentCheck, status: "passed" });

    currentCheck = "restricted folder listing";
    const listing = await call(
      `/2.0/folders/${input.folderId}/items?fields=id,type,name,created_at,modified_at&usemarker=true&limit=1000`,
      token
    );
    if (listing.status !== 200) {
      await discard(listing);
      return stop(currentCheck, "inconclusive");
    }
    const page: unknown = await listing.json();
    if (
      !isObject(page) ||
      !Array.isArray(page.entries) ||
      !page.entries.some(
        (entry: unknown) =>
          isObject(entry) &&
          entry.id === input.fileId &&
          entry.type === "file" &&
          typeof entry.name === "string" &&
          typeof entry.created_at === "string" &&
          typeof entry.modified_at === "string"
      )
    ) {
      return stop(currentCheck, "inconclusive");
    }
    checks.push({ check: currentCheck, status: "passed" });

    for (const item of [
      ...contentPaths,
      { check: "outside folder denied", path: outsidePath },
    ]) {
      currentCheck = item.check;
      const response = await call(item.path, token);
      const status = response.status;
      await discard(response);
      if (status !== 403 && status !== 404) {
        return stop(
          currentCheck,
          status >= 200 && status < 400 ? "failed" : "inconclusive"
        );
      }
      checks.push({ check: currentCheck, status: "passed" });
    }

    currentCheck = "preview capabilities denied";
    const preview = await call(
      `/2.0/files/${input.fileId}?fields=representations,expiring_embed_link`,
      token,
      { headers: { "X-Rep-Hints": "[pdf]" } }
    );
    if (preview.status === 403 || preview.status === 404) {
      await discard(preview);
    } else if (preview.status === 200) {
      const body: unknown = await preview.json();
      if (!isObject(body)) return stop(currentCheck, "inconclusive");
      // Treat unexpected non-empty preview metadata as a failure, even if its
      // shape is different from the currently documented capability objects.
      for (const field of ["expiring_embed_link", "representations"] as const) {
        const value = body[field];
        const emptyRepresentations =
          field === "representations" &&
          isObject(value) &&
          Object.keys(value).every((key) => key === "entries") &&
          Array.isArray(value.entries) &&
          value.entries.length === 0;
        if (value !== undefined && value !== null && !emptyRepresentations) {
          return stop(currentCheck, "failed");
        }
      }
    } else {
      const status = preview.status;
      await discard(preview);
      return stop(
        currentCheck,
        status >= 200 && status < 400 ? "failed" : "inconclusive"
      );
    }
    checks.push({ check: currentCheck, status: "passed" });
    return { verified: true, checks };
  } catch {
    // Transport exceptions and parse failures can contain URLs, tokens, or
    // response fragments. Report only our own fixed check labels.
    return stop(currentCheck, "inconclusive");
  }
}
