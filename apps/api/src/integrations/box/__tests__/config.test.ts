import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { BOX_ENV_VARS, inspectBoxConfiguration } from "../config";

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

  it.each([...BOX_ENV_VARS])(
    "rejects missing %s when Box is partially configured",
    (name) => {
      const result = inspectBoxConfiguration({ ...valid, [name]: "" });
      expect(result.status).toBe("invalid");
      if (result.status !== "invalid") throw new Error("Expected invalid configuration");
      expect(result.errors).toContain(`${name} is required to enable Box OAuth`);
    }
  );

  it.each([
    "https://api.example.org/api/box/oauth/callback",
    "http://127.0.0.1:3001/api/box/oauth/callback",
    "http://[::1]:3001/api/box/oauth/callback",
  ])("accepts secure or local redirect %s", (redirect) => {
    const result = inspectBoxConfiguration({ ...valid, BOX_REDIRECT_URI: redirect });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Expected ready configuration");
    expect(result.config.redirectUri).toBe(redirect);
  });

  it.each([
    "/api/box/oauth/callback",
    "not-a-url",
    "https:api.example.org/api/box/oauth/callback",
    "https:\\api.example.org/api/box/oauth/callback",
    "https://api.example.org/api/box/oauth/call\nback",
    "http://api.example.org/api/box/oauth/callback",
    "http://localhost.example.org/api/box/oauth/callback",
    "ftp://localhost/api/box/oauth/callback",
    "javascript:alert(1)",
    "https://user:secret@example.org/api/box/oauth/callback",
    "https://api.example.org/wrong-callback",
    "https://api.example.org/api/box/oauth/callback/",
    "https://api.example.org/api/box/oauth/callback?code=secret",
    "https://api.example.org/api/box/oauth/callback#secret",
    "https://api.example.org/api/box/oauth/callback?",
    "https://api.example.org/api/box/oauth/callback#",
  ])("rejects unsafe or unusable redirect %s", (redirect) => {
    const result = inspectBoxConfiguration({ ...valid, BOX_REDIRECT_URI: redirect });
    expect(result.status).toBe("invalid");
    expect(JSON.stringify(result)).not.toContain(redirect);
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

  it.each([
    Buffer.alloc(31).toString("base64"),
    Buffer.alloc(33).toString("base64"),
    "not-base64!",
    "x".repeat(32),
    valid.BOX_TOKEN_ENCRYPTION_KEY.slice(0, -1),
    `${valid.BOX_TOKEN_ENCRYPTION_KEY}!`,
    `${valid.BOX_TOKEN_ENCRYPTION_KEY.slice(0, 12)}\n${valid.BOX_TOKEN_ENCRYPTION_KEY.slice(12)}`,
  ])("rejects invalid encryption key encoding %#", (key) => {
    const result = inspectBoxConfiguration({ ...valid, BOX_TOKEN_ENCRYPTION_KEY: key });
    expect(result.status).toBe("invalid");
    expect(JSON.stringify(result)).not.toContain(key);
  });

  it.each(["BOX_CLIENT_ID", "BOX_CLIENT_SECRET"])(
    "rejects whitespace inside %s",
    (name) => {
      const result = inspectBoxConfiguration({ ...valid, [name]: "secret\r\ninjected" });
      expect(result.status).toBe("invalid");
      expect(JSON.stringify(result)).not.toContain("injected");
    }
  );

  it("trims copy/paste whitespace without changing the caller's environment", () => {
    const env = Object.fromEntries(
      Object.entries(valid).map(([key, value]) => [key, ` ${value} `])
    );
    expect(inspectBoxConfiguration(env)).toEqual(inspectBoxConfiguration(valid));
    expect(env.BOX_CLIENT_SECRET).toBe(` ${valid.BOX_CLIENT_SECRET} `);
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

  it("starts without Box credentials", () => {
    expect(run(required).code).toBe(0);
  });

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

  it("recognizes complete configuration without exposing values", () => {
    const result = run({ ...required, ...valid });
    expect(result.code).toBe(0);
    expect(result.output).not.toContain("Box unavailable");
    expect(result.output).not.toContain("BOX_CLIENT_ID");
    expect(result.output).not.toContain(valid.BOX_CLIENT_SECRET);
    expect(result.output).not.toContain(valid.BOX_TOKEN_ENCRYPTION_KEY);
  });

  it("still rejects missing required database configuration", () => {
    const result = run(valid);
    expect(result.code).toBe(1);
    expect(result.output).toContain("Missing required environment variables");
    expect(result.output).toContain("D1_DATABASE_ID");
    expect(result.output).not.toContain(valid.BOX_CLIENT_SECRET);
  });
});
