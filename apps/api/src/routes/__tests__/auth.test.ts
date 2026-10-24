import { describe, it, expect, beforeAll, mock, beforeEach } from "bun:test";
import { Hono } from "hono";

const mockQuery = mock(() => Promise.resolve([]));
const mockExecute = mock(() => Promise.resolve());

mock.module("../../integrations/database", () => ({
  query: mockQuery,
  execute: mockExecute,
}));

let app: Hono;

beforeAll(async () => {
  const { default: authRoutes } = await import("../auth");
  app = new Hono();
  app.route("/api/auth", authRoutes);
});

beforeEach(() => {
  mockQuery.mockReset();
  mockExecute.mockReset();
  mockQuery.mockImplementation(() => Promise.resolve([]));
  mockExecute.mockImplementation(() => Promise.resolve());
});

describe("POST /api/auth/register", () => {
  it("creates a new user and returns a token", async () => {
    let callCount = 0;
    mockQuery.mockImplementation(() => {
      callCount++;
      // 1: check existing user
      if (callCount === 1) return Promise.resolve([]);
      // 2: get created user id
      if (callCount === 2) return Promise.resolve([{ id: "user-1" }]);
      return Promise.resolve([]);
    });

    const res = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "password123" }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toBeDefined();
    expect(typeof body.token).toBe("string");
  });

  it("returns 400 without email", async () => {
    const res = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "password123" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 without password", async () => {
    const res = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for short password", async () => {
    const res = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "short" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("8 characters");
  });

  it("returns 409 if email already exists", async () => {
    mockQuery.mockImplementation(() =>
      Promise.resolve([{ id: "existing-user" }])
    );

    const res = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "password123" }),
    });

    expect(res.status).toBe(409);
  });
});

describe("POST /api/auth/login", () => {
  it("returns a token for valid credentials", async () => {
    const hash = await Bun.password.hash("password123");
    mockQuery.mockImplementation(() =>
      Promise.resolve([{ id: "user-1", password_hash: hash }])
    );

    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "password123" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeDefined();
  });

  it("returns 401 for wrong password", async () => {
    const hash = await Bun.password.hash("correctpassword");
    mockQuery.mockImplementation(() =>
      Promise.resolve([{ id: "user-1", password_hash: hash }])
    );

    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "wrongpassword" }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Invalid");
  });

  it("returns 401 for non-existent email", async () => {
    mockQuery.mockImplementation(() => Promise.resolve([]));

    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com", password: "password123" }),
    });

    expect(res.status).toBe(401);
  });

  it("returns 400 without credentials", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/logout", () => {
  it("deletes the session", async () => {
    mockQuery.mockImplementation(() =>
      Promise.resolve([{ user_id: "user-1", expires_at: "2099-01-01" }])
    );

    const res = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: "Bearer valid-token" },
    });

    expect(res.status).toBe(200);
    expect(mockExecute).toHaveBeenCalled();
  });

  it("returns 401 without auth", async () => {
    mockQuery.mockImplementation(() => Promise.resolve([]));

    const res = await app.request("/api/auth/logout", {
      method: "POST",
    });

    expect(res.status).toBe(401);
  });
});

describe("GET /api/auth/me", () => {
  it("returns 401 without auth header", async () => {
    mockQuery.mockImplementation(() => Promise.resolve([]));

    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns user data with valid auth", async () => {
    let callCount = 0;
    mockQuery.mockImplementation(() => {
      callCount++;
      if (callCount === 1)
        return Promise.resolve([{ user_id: "user-1", expires_at: "2099-01-01" }]);
      if (callCount === 2)
        return Promise.resolve([{
          id: "user-1",
          email: "test@example.com",
          name: "Test User",
          created_at: "2024-01-01",
        }]);
      return Promise.resolve([]);
    });

    const res = await app.request("/api/auth/me", {
      headers: { Authorization: "Bearer valid-token" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe("test@example.com");
  });
});
