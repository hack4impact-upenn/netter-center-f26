import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { inspectBoxConfiguration } from "../config";

const valid = {
  BOX_CLIENT_ID: "test-client-id",
  BOX_CLIENT_SECRET: "test-client-secret",
  BOX_REDIRECT_URI: "http://localhost:3001/api/box/oauth/callback",
  BOX_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};

describe("Box OAuth configuration", () => {
  it("leaves Box disabled when no values are configured", () => {
    expect(inspectBoxConfiguration({})).toEqual({ status: "disabled" });
    expect(inspectBoxConfiguration({ BOX_CLIENT_ID: "  " })).toEqual({
      status: "disabled",
    });
  });

  it("loads the configured identity, exact redirect, and decoded 32-byte key", () => {
    const result = inspectBoxConfiguration(valid);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Expected ready configuration");
    expect(result.config).toEqual({
      clientId: valid.BOX_CLIENT_ID,
      clientSecret: valid.BOX_CLIENT_SECRET,
      redirectUri: valid.BOX_REDIRECT_URI,
      tokenEncryptionKey: Buffer.alloc(32, 7),
    });
  });

  it("requires HTTPS even for localhost in production", () => {
    expect(inspectBoxConfiguration({ ...valid, NODE_ENV: "production" }).status).toBe(
      "invalid"
    );
    expect(
      inspectBoxConfiguration({
        ...valid,
        NODE_ENV: "production",
        BOX_REDIRECT_URI: "https://api.example.org/api/box/oauth/callback",
      }).status
    ).toBe("ready");
  });
});

describe("API startup with optional Box integration", () => {
  const cwd = fileURLToPath(new URL("../../../../", import.meta.url));
  const required = {
    CLOUDFLARE_ACCOUNT_ID: "fixture-account",
    CLOUDFLARE_API_TOKEN: "fixture-cloudflare-token",
    D1_DATABASE_ID: "fixture-database",
  };

  function run(env: Record<string, string>) {
    const child = Bun.spawnSync(
      [
        process.execPath,
        "--no-env-file",
        "--eval",
        "import { validateEnv } from './src/env.ts'; validateEnv();",
      ],
      { cwd, env }
    );
    return {
      code: child.exitCode,
      output: `${child.stdout.toString()}${child.stderr.toString()}`,
    };
  }

  it("reports incomplete Box configuration without leaking credentials or stopping the API", () => {
    const result = run({
      ...required,
      BOX_CLIENT_ID: "private-client-id",
      BOX_CLIENT_SECRET: "private-client-secret",
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain("Box unavailable: BOX_REDIRECT_URI is required");
    expect(result.output).toContain("BOX_TOKEN_ENCRYPTION_KEY is required");
    expect(result.output).not.toContain("private-client");
    expect(result.output).not.toContain(required.CLOUDFLARE_API_TOKEN);
  });
});
