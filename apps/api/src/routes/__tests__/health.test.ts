import { describe, it, expect } from "bun:test";
import { Hono } from "hono";

describe("GET /api/health", () => {
  const app = new Hono();
  app.get("/api/health", (c) => c.json({ status: "ok" }));

  it("returns 200 with status ok", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });
});
