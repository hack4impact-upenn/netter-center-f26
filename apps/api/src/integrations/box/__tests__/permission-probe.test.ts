import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import {
  verifyBoxPermissions,
  type PermissionProbeInput,
  type ProbeRequest,
} from "../permission-probe";

const input: PermissionProbeInput = {
  accessToken: "parent-oauth-secret",
  folderId: "123",
  fileId: "456",
  outsideFolderId: "789",
  confirmSyntheticFixtures: true,
};
const restrictedToken = "restricted-secret";
const previewUrl = "https://example.box.com/secret-preview-capability";
const previewFixture = {
  id: input.fileId,
  type: "file",
  parent: { id: input.folderId },
  representations: {
    entries: [{ representation: "pdf", content: { url_template: previewUrl } }],
  },
  expiring_embed_link: { url: previewUrl },
};
const tokenFixture = {
  access_token: restrictedToken,
  token_type: "bearer",
  expires_in: 900,
  restricted_to: [
    { scope: "base_explorer", object: { id: input.folderId, type: "folder" } },
  ],
};
const listingFixture = {
  entries: [
    {
      id: input.fileId,
      type: "file",
      name: "synthetic-sensitive-name.pdf",
      created_at: "2026-11-07T12:00:00Z",
      modified_at: "2026-11-07T12:00:00Z",
    },
  ],
};

type Call = { url: URL; init: RequestInit; token: string | null };
type Override = (call: Call, index: number) => Response | Promise<Response> | undefined;

function fixtureTransport(override?: Override) {
  const calls: Call[] = [];
  const request: ProbeRequest = async (url, init) => {
    const call = {
      url: new URL(url),
      init,
      token: new Headers(init.headers).get("Authorization"),
    };
    calls.push(call);
    const overridden = override?.(call, calls.length - 1);
    if (overridden !== undefined) return overridden;

    if (call.url.pathname === "/oauth2/token") return Response.json(tokenFixture);
    const parent = call.token === `Bearer ${input.accessToken}`;
    if (call.url.pathname === `/2.0/files/${input.fileId}`) {
      return parent ? Response.json(previewFixture) : new Response(null, { status: 403 });
    }
    if (call.url.pathname === `/2.0/files/${input.fileId}/content`) {
      return new Response(null, {
        status: parent ? 302 : 403,
        headers: parent ? { Location: "https://dl.boxcloud.com/content-secret" } : {},
      });
    }
    if (call.url.pathname === `/2.0/files/${input.fileId}/thumbnail.png`) {
      return new Response(null, { status: parent ? 200 : 403 });
    }
    if (call.url.pathname === `/2.0/folders/${input.outsideFolderId}/items`) {
      return parent
        ? Response.json({ entries: [] })
        : new Response(null, { status: 404 });
    }
    if (call.url.pathname === `/2.0/folders/${input.folderId}/items`) {
      return Response.json(listingFixture);
    }
    if (call.url.pathname === `/2.0/folders/${input.folderId}`) {
      return Response.json({ id: input.folderId, name: "synthetic-restricted-folder" });
    }
    throw new Error("Unexpected fixture request");
  };
  return { request, calls };
}

describe("Box synthetic permissions experiment", () => {
  it("verifies positive controls, fixed-scope token exchange, metadata listing, and all denials", async () => {
    const { request, calls } = fixtureTransport();
    const result = await verifyBoxPermissions(input, request);
    expect(result.verified).toBe(true);
    expect(result.checks).toHaveLength(11);
    expect(result.checks.every((check) => check.status === "passed")).toBe(true);
    expect(calls).toHaveLength(11);
    expect(calls.every((call) => call.url.origin === "https://api.box.com")).toBe(true);
    expect(calls.every((call) => call.init.redirect === "manual")).toBe(true);
    expect(calls.every((call) => call.init.signal instanceof AbortSignal)).toBe(true);
    const exchange = calls.find((call) => call.url.pathname === "/oauth2/token");
    expect(exchange?.init.method).toBe("POST");
    const form = exchange?.init.body as URLSearchParams;
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: input.accessToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      scope: "base_explorer",
      resource: "https://api.box.com/2.0/folders/123",
    });
    const listing = calls.find((call) => call.url.pathname === "/2.0/folders/123/items");
    expect(listing?.token).toBe(`Bearer ${restrictedToken}`);
    expect(listing?.url.searchParams.get("fields")).toBe(
      "id,type,name,created_at,modified_at"
    );
    expect(listing?.url.searchParams.get("usemarker")).toBe("true");
    expect(
      calls.slice(5).every((call) => call.token === `Bearer ${restrictedToken}`)
    ).toBe(true);
    for (const secret of [
      input.accessToken,
      restrictedToken,
      previewUrl,
      "synthetic-sensitive-name.pdf",
      "synthetic-restricted-folder",
    ]) {
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  });

  it("requires a working download with the parent token", async () => {
    const failureIndex = 1;
    const { request, calls } = fixtureTransport((_, index) =>
      index === failureIndex ? new Response(null, { status: 404 }) : undefined
    );
    const result = await verifyBoxPermissions(input, request);
    expect(result.verified).toBe(false);
    expect(result.checks.at(-1)?.status).toBe("inconclusive");
    expect(calls.some((call) => call.url.pathname === "/oauth2/token")).toBe(false);
  });

  it("requires permission to read the requested folder name", async () => {
    const response = new Response(null, { status: 403 });
    const { request, calls } = fixtureTransport((_, index) =>
      index === 10 ? response : undefined
    );
    const result = await verifyBoxPermissions(input, request);
    expect(result.verified).toBe(false);
    expect(result.checks.at(-1)).toEqual({
      check: "restricted folder name lookup",
      status: "inconclusive",
    });
    expect(calls[10]?.url.searchParams.get("fields")).toBe("id,name");
  });

  it("fails if a restricted download redirects to content", async () => {
    const failureIndex = 6;
    const { request, calls } = fixtureTransport((_, index) =>
      index === failureIndex
        ? new Response(null, { status: 302, headers: { Location: previewUrl } })
        : undefined
    );
    const result = await verifyBoxPermissions(input, request);
    expect(result.verified).toBe(false);
    expect(result.checks.at(-1)?.status).toBe("failed");
    expect(calls).toHaveLength(failureIndex + 1);
    expect(calls.every((call) => call.url.origin === "https://api.box.com")).toBe(true);
    expect(JSON.stringify(result)).not.toContain(previewUrl);
  });

  it("fails if Box returns an embed preview link", async () => {
    const body = { expiring_embed_link: { url: previewUrl } };
    const { request } = fixtureTransport((_, index) =>
      index === 9 ? Response.json(body) : undefined
    );
    const result = await verifyBoxPermissions(input, request);
    expect(result.verified).toBe(false);
    expect(result.checks.at(-1)).toEqual({
      check: "preview capabilities denied",
      status: "failed",
    });
    expect(JSON.stringify(result)).not.toContain(previewUrl);
  });
});

describe("live permissions CLI", () => {
  it("fails closed without opt-in and never prints environment credentials", () => {
    const child = Bun.spawnSync(
      [process.execPath, "--no-env-file", "scripts/verify-box-permissions.ts"],
      {
        cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
        env: { BOX_PERMISSION_TEST_ACCESS_TOKEN: input.accessToken },
      }
    );
    expect(child.exitCode).toBe(1);
    const output = `${child.stdout.toString()}${child.stderr.toString()}`;
    expect(output).toContain("synthetic fixtures");
    expect(output).not.toContain(input.accessToken);
  });
});
