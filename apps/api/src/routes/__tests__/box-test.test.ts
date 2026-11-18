import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createBoxTestRoutes } from "../box-test";

const base = "/api/box/test";
const enabled = { NODE_ENV: "development", BOX_ENABLE_TEST_PAGE: "true" };
const app = (env: Record<string, string | undefined>) =>
  new Hono().route(base, createBoxTestRoutes(env));

describe("Box test page routes", () => {
  it.each([
    {},
    { NODE_ENV: "development" },
    { BOX_ENABLE_TEST_PAGE: "true" },
    { NODE_ENV: "development", BOX_ENABLE_TEST_PAGE: "false" },
    { NODE_ENV: "test", BOX_ENABLE_TEST_PAGE: "true" },
    { NODE_ENV: "production", BOX_ENABLE_TEST_PAGE: "true" },
  ] satisfies Record<string, string>[])(
    "hides both assets unless enabled in development %#",
    async (env) => {
      for (const path of [base, base + "/client.js"]) {
        expect((await app(env).request(path)).status).toBe(404);
      }
    }
  );

  it("serves the test form with a same-origin script and blocks framing and form navigation", async () => {
    const response = await app(enabled).request(base);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    const policy = response.headers.get("Content-Security-Policy");
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("form-action 'none'");
    const body = await response.text();
    expect(body).toContain('src="/api/box/test/client.js"');
    expect(body).toContain('type="password"');
    expect(body).toContain('target="_blank" rel="noopener noreferrer"');
  });

  it("serves only the fixed test script with non-cacheable same-origin headers", async () => {
    const response = await app(enabled).request(base + "/client.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/javascript");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.text()).toContain('"/api/auth/login"');
    expect((await app(enabled).request(base + "/other.js")).status).toBe(404);
    expect((await app(enabled).request(base, { method: "POST" })).status).toBe(404);
  });

  it("rejects credentials or other parameters in the URL without reflecting values", async () => {
    for (const path of [base, base + "/client.js"]) {
      const response = await app(enabled).request(path + "?token=synthetic-private");
      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.text()).toBe("Unexpected query parameters");
    }
  });
});
