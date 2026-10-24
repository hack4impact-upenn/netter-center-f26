import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import { errorHandler } from "../error";

function createApp() {
  const app = new Hono();
  app.onError(errorHandler);
  return app;
}

describe("errorHandler", () => {
  it("passes through successful responses", async () => {
    const app = createApp();
    app.get("/ok", (c) => c.json({ status: "ok" }));

    const res = await app.request("/ok");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("catches thrown errors and returns generic 500", async () => {
    const app = createApp();
    app.get("/fail", () => {
      throw new Error("sensitive database error details");
    });

    const res = await app.request("/fail");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal server error");
  });

  it("does not leak error details to the client", async () => {
    const app = createApp();
    app.get("/leak", () => {
      throw new Error("SQLITE_ERROR: no such table: users");
    });

    const res = await app.request("/leak");
    const body = await res.json();
    expect(body.error).not.toContain("SQLITE");
    expect(body.error).toBe("Internal server error");
  });

  it("handles async errors", async () => {
    const app = createApp();
    app.get("/async-fail", async () => {
      throw new Error("Async failure");
    });

    const res = await app.request("/async-fail");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal server error");
  });
});
