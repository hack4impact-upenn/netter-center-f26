import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

// Other route suites mock the database module process-wide. A subprocess exercises
// the actual default D1 adapter with an isolated fetch stub and synthetic env only.
function request(body: unknown, status = 200, throughStore = false) {
  const script = `
    import { query } from './src/integrations/database/index.ts';
    import { BoxStore } from './src/integrations/box/store.ts';
    globalThis.fetch = async (url, init) => {
      if (url !== 'https://api.cloudflare.com/client/v4/accounts/test-account/d1/database/test-database/query') throw new Error('Unexpected URL');
      const payload = JSON.parse(init.body);
      if (init.method !== 'POST' || !Array.isArray(payload.params)) throw new Error('Invalid D1 request');
      return new Response(JSON.stringify(${JSON.stringify(body)}), { status: ${status} });
    };
    try {
      const value = ${
        throughStore
          ? "await new BoxStore({ encryptionKey: new Uint8Array(32) }).getConnection('user-1')"
          : "await query('SELECT id FROM users WHERE id = ?', ['user-1'])"
      };
      console.log(JSON.stringify(value));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  `;
  const result = Bun.spawnSync([process.execPath, "--no-env-file", "--eval", script], {
    cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
    env: {
      CLOUDFLARE_ACCOUNT_ID: "test-account",
      CLOUDFLARE_API_TOKEN: "synthetic-cloudflare-secret",
      D1_DATABASE_ID: "test-database",
    },
  });
  return {
    code: result.exitCode,
    output: `${result.stdout.toString()}${result.stderr.toString()}`.trim(),
  };
}

describe("Box default D1 transport", () => {
  it("preserves valid query rows and legitimate empty results", () => {
    expect(
      request({ success: true, result: [{ success: true, results: [{ id: "user-1" }] }] })
    ).toEqual({ code: 0, output: '[{"id":"user-1"}]' });
    expect(request({ success: true, result: [{ success: true, results: [] }] })).toEqual({
      code: 0,
      output: "[]",
    });
    expect(
      request({ success: true, result: [{ success: true, results: [] }] }, 200, true)
    ).toEqual({ code: 0, output: "null" });
  });

  it.each([
    null,
    {},
    { result: [] },
    { result: [{}] },
    { success: false, result: [{ results: [] }] },
    { success: true, result: [{ success: false, results: [] }] },
    { success: true, result: [{ results: "invalid" }] },
  ])(
    "treats malformed or failed responses as errors, not empty query results %#",
    (body) => {
      expect(request(body)).toEqual({
        code: 1,
        output: "D1 query returned an invalid result",
      });
    }
  );

  it.each([200, 500])(
    "sanitizes upstream persistence failures through BoxStore for HTTP %i",
    (status) => {
      const result = request(
        { errors: [{ message: "sensitive upstream SQL and session-secret" }] },
        status,
        true
      );
      expect(result).toEqual({ code: 1, output: "Box persistence operation failed" });
      expect(result.output).not.toContain("session-secret");
      expect(result.output).not.toContain("synthetic-cloudflare-secret");
    }
  );
});
