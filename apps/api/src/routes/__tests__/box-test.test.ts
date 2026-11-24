import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createBoxTestRoutes } from "../box-test";

const base = "/api/box/test";
const enabled = { NODE_ENV: "development", BOX_ENABLE_TEST_PAGE: "true" };
const app = (env: Record<string, string | undefined>) =>
  new Hono().route(base, createBoxTestRoutes(env));

describe("Box test page routes", () => {
  it("hides both assets by default and in production", async () => {
    for (const env of [
      { NODE_ENV: "development" },
      { NODE_ENV: "production", BOX_ENABLE_TEST_PAGE: "true" },
    ]) {
      for (const path of [base, base + "/client.js"]) {
        expect((await app(env).request(path)).status).toBe(404);
      }
    }
  });

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
    const script = await app(enabled).request(base + "/client.js");
    expect(script.headers.get("Content-Type")).toContain("text/javascript");
    expect(script.headers.get("Cache-Control")).toBe("no-store");
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
