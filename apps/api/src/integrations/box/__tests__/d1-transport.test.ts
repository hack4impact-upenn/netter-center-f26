import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

// Isolate the real adapter from the boilerplate route suites' module mocks.
it("rejects a failed D1 result even when its HTTP status is 200", () => {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--no-env-file",
      "--eval",
      `
        import assert from "node:assert/strict";
        import { query } from "./src/integrations/database/index.ts";
        globalThis.fetch = async () => Response.json({
          success: true, result: [{ success: false, results: [] }],
        });
        await assert.rejects(query("SELECT 1"), /invalid result/);
      `,
    ],
    { cwd: fileURLToPath(new URL("../../../../", import.meta.url)), env: {} }
  );
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
});
