import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { Hono } from "hono";
import { logger } from "../logger";

describe("logger middleware", () => {
  const originalLog = console.log;
  let logOutput: string[];

  beforeEach(() => {
    logOutput = [];
    console.log = mock((...args: unknown[]) => {
      logOutput.push(args.join(" "));
    }) as typeof console.log;
  });

  // Restore after all tests
  afterAll(() => {
    console.log = originalLog;
  });

  it("logs request method, path, status, and duration", async () => {
    const app = new Hono();
    app.use("*", logger);
    app.get("/test", (c) => c.json({ ok: true }));

    await app.request("/test");

    expect(logOutput.length).toBe(1);
    expect(logOutput[0]).toContain("200");
    expect(logOutput[0]).toContain("GET");
    expect(logOutput[0]).toContain("/test");
    expect(logOutput[0]).toMatch(/\d+ms/);
  });

  it("logs 404 responses", async () => {
    const app = new Hono();
    app.use("*", logger);
    // No routes defined — Hono returns 404

    await app.request("/nonexistent");

    expect(logOutput.length).toBe(1);
    expect(logOutput[0]).toContain("404");
  });

  it("includes POST method in log", async () => {
    const app = new Hono();
    app.use("*", logger);
    app.post("/submit", (c) => c.json({ ok: true }));

    await app.request("/submit", { method: "POST" });

    expect(logOutput[0]).toContain("POST");
    expect(logOutput[0]).toContain("/submit");
  });
});
