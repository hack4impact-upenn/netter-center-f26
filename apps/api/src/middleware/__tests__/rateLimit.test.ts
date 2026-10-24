import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import { rateLimit } from "../rateLimit";

describe("rateLimit middleware", () => {
  it("allows requests under the limit", async () => {
    const app = new Hono();
    app.use("*", rateLimit(3, 60000));
    app.get("/test", (c) => c.json({ ok: true }));

    const res1 = await app.request("/test");
    const res2 = await app.request("/test");
    const res3 = await app.request("/test");

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res3.status).toBe(200);
  });

  it("blocks requests over the limit", async () => {
    const app = new Hono();
    app.use("*", rateLimit(2, 60000));
    app.get("/limited", (c) => c.json({ ok: true }));

    await app.request("/limited");
    await app.request("/limited");
    const res3 = await app.request("/limited");

    expect(res3.status).toBe(429);
    const body = await res3.json();
    expect(body.error).toContain("Too many requests");
  });
});
