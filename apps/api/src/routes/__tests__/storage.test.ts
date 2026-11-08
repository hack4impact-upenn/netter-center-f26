import { describe, it, expect, beforeAll, mock } from "bun:test";
import { Hono } from "hono";

mock.module("../../integrations/database", () => ({
  query: mock(() =>
    Promise.resolve([{ user_id: "user-1", expires_at: "2099-01-01" }])
  ),
  execute: mock(() => Promise.resolve()),
}));

const mockUpload = mock(() => Promise.resolve());
const mockDownload = mock(
  (): Promise<Uint8Array<ArrayBuffer> | null> =>
    Promise.resolve(new Uint8Array([72, 101, 108, 108, 111]))
);
const mockRemove = mock(() => Promise.resolve());
const mockList = mock(() => Promise.resolve(["file1.txt", "file2.txt"]));

mock.module("../../integrations/storage", () => ({
  upload: mockUpload,
  download: mockDownload,
  remove: mockRemove,
  list: mockList,
}));

const authHeader = { Authorization: "Bearer valid-token" };

let app: Hono;

beforeAll(async () => {
  const { default: storageRoutes } = await import("../storage");
  app = new Hono();
  app.route("/api/storage", storageRoutes);
});

describe("GET /api/storage/list", () => {
  it("returns list of keys", async () => {
    const res = await app.request("/api/storage/list", {
      headers: authHeader,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keys).toEqual(["file1.txt", "file2.txt"]);
  });

  it("passes prefix query param", async () => {
    await app.request("/api/storage/list?prefix=uploads/", {
      headers: authHeader,
    });

    expect(mockList).toHaveBeenCalledWith("uploads/");
  });
});

describe("GET /api/storage/download/:key", () => {
  it("returns file data", async () => {
    const res = await app.request("/api/storage/download/test.txt", {
      headers: authHeader,
    });

    expect(res.status).toBe(200);
    expect(mockDownload).toHaveBeenCalledWith("test.txt");
  });

  it("returns 404 for missing file", async () => {
    mockDownload.mockImplementationOnce(() => Promise.resolve(null));

    const res = await app.request("/api/storage/download/missing.txt", {
      headers: authHeader,
    });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/storage/:key", () => {
  it("deletes a file", async () => {
    const res = await app.request("/api/storage/test.txt", {
      method: "DELETE",
      headers: authHeader,
    });

    expect(res.status).toBe(204);
    expect(mockRemove).toHaveBeenCalledWith("test.txt");
  });
});

describe("auth protection", () => {
  it("returns 401 without auth header", async () => {
    const res = await app.request("/api/storage/list");
    expect(res.status).toBe(401);
  });
});
