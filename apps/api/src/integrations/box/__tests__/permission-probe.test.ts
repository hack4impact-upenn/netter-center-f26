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
    throw new Error("Unexpected fixture request");
  };
  return { request, calls };
}

describe("Box synthetic permissions experiment", () => {
  it("verifies positive controls, fixed-scope token exchange, metadata listing, and all denials", async () => {
    const { request, calls } = fixtureTransport();
    const result = await verifyBoxPermissions(input, request);
    expect(result.verified).toBe(true);
    expect(result.checks).toHaveLength(10);
    expect(result.checks.every((check) => check.status === "passed")).toBe(true);
    expect(calls).toHaveLength(10);
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
    ]) {
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  });

  it("refuses to run without explicit synthetic-fixture confirmation", async () => {
    const { request, calls } = fixtureTransport();
    await expect(
      verifyBoxPermissions({ ...input, confirmSyntheticFixtures: false }, request)
    ).rejects.toThrow("synthetic");
    expect(calls).toHaveLength(0);
  });

  it.each(["folderId", "fileId", "outsideFolderId"] as const)(
    "validates %s before sending any token",
    async (name) => {
      for (const id of [
        "",
        "0",
        "-1",
        "1.5",
        "123/../files",
        "https://evil.example",
        "1?fields=shared_link",
        "1".repeat(65),
      ]) {
        const { request, calls } = fixtureTransport();
        await expect(
          verifyBoxPermissions({ ...input, [name]: id }, request)
        ).rejects.toThrow(`Invalid ${name}`);
        expect(calls).toHaveLength(0);
      }
    }
  );

  it("requires distinct inside and outside folders", async () => {
    const { request, calls } = fixtureTransport();
    await expect(
      verifyBoxPermissions({ ...input, outsideFolderId: input.folderId }, request)
    ).rejects.toThrow("differ");
    expect(calls).toHaveLength(0);
  });

  it.each(["", "token with spaces", "token\r\nInjected: yes"])(
    "rejects missing or malformed token %#",
    async (token) => {
      const { request, calls } = fixtureTransport();
      await expect(
        verifyBoxPermissions({ ...input, accessToken: token }, request)
      ).rejects.toThrow("access token");
      expect(calls).toHaveLength(0);
    }
  );

  it.each([
    { ...previewFixture, id: "999" },
    { ...previewFixture, type: "folder" },
    { ...previewFixture, parent: { id: "999" } },
    { ...previewFixture, representations: { entries: [] } },
    { ...previewFixture, expiring_embed_link: null },
  ])("requires a valid, preview-ready file in the fixture folder %#", async (fixture) => {
    const { request, calls } = fixtureTransport((_, index) =>
      index === 0 ? Response.json(fixture) : undefined
    );
    const result = await verifyBoxPermissions(input, request);
    expect(result).toEqual({
      verified: false,
      checks: [{ check: "fixture metadata positive control", status: "inconclusive" }],
    });
    expect(calls).toHaveLength(1);
  });

  it.each([0, 1, 2, 3])(
    "does not interpret a failed positive control as denied permissions at request %i",
    async (failureIndex) => {
      const { request, calls } = fixtureTransport((_, index) =>
        index === failureIndex ? new Response(null, { status: 404 }) : undefined
      );
      const result = await verifyBoxPermissions(input, request);
      expect(result.verified).toBe(false);
      expect(result.checks.at(-1)?.status).toBe("inconclusive");
      expect(calls.some((call) => call.url.pathname === "/oauth2/token")).toBe(false);
    }
  );

  it.each([401, 403, 429, 500])(
    "handles exchange failure %i without claiming verification",
    async (status) => {
      const { request } = fixtureTransport((_, index) =>
        index === 4 ? new Response("sensitive upstream body", { status }) : undefined
      );
      const result = await verifyBoxPermissions(input, request);
      expect(result.checks.at(-1)).toEqual({
        check: "folder token exchange",
        status: "inconclusive",
      });
      expect(result.verified).toBe(false);
      expect(JSON.stringify(result)).not.toContain("sensitive");
    }
  );

  it("requires a valid outside-folder positive-control response", async () => {
    const { request, calls } = fixtureTransport((_, index) =>
      index === 3 ? Response.json({ unexpected: [] }) : undefined
    );
    const result = await verifyBoxPermissions(input, request);
    expect(result.verified).toBe(false);
    expect(result.checks.at(-1)).toEqual({
      check: "outside folder positive control",
      status: "inconclusive",
    });
    expect(calls).toHaveLength(4);
  });

  it.each([
    { ...tokenFixture, access_token: "" },
    { ...tokenFixture, access_token: input.accessToken },
    { ...tokenFixture, access_token: "bad\r\ntoken" },
    { ...tokenFixture, token_type: "unexpected" },
    { ...tokenFixture, restricted_to: [] },
    {
      ...tokenFixture,
      restricted_to: [...tokenFixture.restricted_to, { scope: "item_download" }],
    },
    {
      ...tokenFixture,
      restricted_to: [{ scope: "item_download", object: { id: "123", type: "folder" } }],
    },
    {
      ...tokenFixture,
      restricted_to: [{ scope: "base_explorer", object: { id: "999", type: "folder" } }],
    },
    {
      ...tokenFixture,
      restricted_to: [{ scope: "base_explorer", object: { id: "123", type: "file" } }],
    },
  ])("rejects malformed or incorrectly restricted tokens %#", async (fixture) => {
    const { request, calls } = fixtureTransport((_, index) =>
      index === 4 ? Response.json(fixture) : undefined
    );
    const result = await verifyBoxPermissions(input, request);
    expect(result.verified).toBe(false);
    expect(result.checks.at(-1)?.check).toBe("folder token exchange");
    expect(calls).toHaveLength(5);
  });

  it.each([
    { entries: [] },
    { entries: [{ id: "456", type: "folder", name: "folder" }] },
    { entries: [{ id: "999", type: "file", name: "wrong.pdf" }] },
    { entries: [{ id: "456", type: "file", name: "missing-timestamps.pdf" }] },
    { unexpected: [] },
  ])(
    "requires the actual fixture and timestamp metadata in the restricted listing %#",
    async (fixture) => {
      const { request } = fixtureTransport((_, index) =>
        index === 5 ? Response.json(fixture) : undefined
      );
      const result = await verifyBoxPermissions(input, request);
      expect(result.verified).toBe(false);
      expect(result.checks.at(-1)).toEqual({
        check: "restricted folder listing",
        status: "inconclusive",
      });
    }
  );

  it("does not treat an expired restricted token as successful denials", async () => {
    const { request, calls } = fixtureTransport((_, index) =>
      index === 5 ? new Response(null, { status: 401 }) : undefined
    );
    const result = await verifyBoxPermissions(input, request);
    expect(result.verified).toBe(false);
    expect(result.checks.at(-1)?.status).toBe("inconclusive");
    expect(calls).toHaveLength(6);
  });

  it.each([6, 7, 8, 9])(
    "fails if a restricted operation succeeds or redirects at request %i",
    async (failureIndex) => {
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
    }
  );

  it.each([6, 7, 8, 9])(
    "does not count upstream errors as permission denials at request %i",
    async (failureIndex) => {
      for (const status of [401, 429, 500, 503]) {
        const { request } = fixtureTransport((_, index) =>
          index === failureIndex ? new Response(null, { status }) : undefined
        );
        const result = await verifyBoxPermissions(input, request);
        expect(result.verified).toBe(false);
        expect(result.checks.at(-1)?.status).toBe("inconclusive");
      }
    }
  );

  it.each([403, 404])(
    "accepts explicit denial %i with valid positive controls",
    async (status) => {
      const { request } = fixtureTransport((_, index) =>
        index >= 6 ? new Response(null, { status }) : undefined
      );
      expect((await verifyBoxPermissions(input, request)).verified).toBe(true);
    }
  );

  it("accepts file metadata when preview capabilities are absent", async () => {
    const { request } = fixtureTransport((_, index) =>
      index === 9
        ? Response.json({
            id: "456",
            representations: { entries: [] },
            expiring_embed_link: null,
          })
        : undefined
    );
    expect((await verifyBoxPermissions(input, request)).verified).toBe(true);
  });

  it.each([
    { representations: previewFixture.representations },
    { expiring_embed_link: { url: previewUrl } },
    { representations: { unknown_capability: previewUrl } },
    { expiring_embed_link: "unexpected-capability" },
    { representations: [] },
  ])(
    "fails when any preview capability or unexpected preview shape is returned %#",
    async (body) => {
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
    }
  );

  it.each([0, 3, 4, 5, 9])(
    "sanitizes malformed upstream JSON at request %i",
    async (failureIndex) => {
      const { request } = fixtureTransport((_, index) =>
        index === failureIndex
          ? new Response(`invalid-json-${input.accessToken}`)
          : undefined
      );
      const result = await verifyBoxPermissions(input, request);
      expect(result.verified).toBe(false);
      expect(result.checks.at(-1)?.status).toBe("inconclusive");
      expect(JSON.stringify(result)).not.toContain(input.accessToken);
    }
  );

  it("sanitizes transport failures including token-bearing messages", async () => {
    const { request } = fixtureTransport(() => {
      throw new Error(`network failed: ${input.accessToken}`);
    });
    const result = await verifyBoxPermissions(input, request);
    expect(result.verified).toBe(false);
    expect(result.checks.at(-1)?.status).toBe("inconclusive");
    expect(JSON.stringify(result)).not.toContain(input.accessToken);
  });

  it("cancels content responses rather than reading or following them", async () => {
    let cancelled = 0;
    const { request } = fixtureTransport((_, index) => {
      if (![1, 2, 6, 7].includes(index)) return undefined;
      return new Response(
        new ReadableStream({
          cancel() {
            cancelled++;
          },
        }),
        {
          status: index < 3 ? 200 : 403,
        }
      );
    });
    expect((await verifyBoxPermissions(input, request)).verified).toBe(true);
    expect(cancelled).toBe(4);
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
