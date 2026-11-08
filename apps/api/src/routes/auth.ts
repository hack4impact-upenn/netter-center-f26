import { Hono } from "hono";
import { query, execute } from "../integrations/database";
import { requireAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rateLimit";
import type { AppEnv } from "../types";

const authRateLimit = rateLimit(10, 15 * 60 * 1000);

type User = {
  id: string;
  email: string;
  name: string;
  created_at: string;
};

const auth = new Hono<AppEnv>();

auth.post("/register", authRateLimit, async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();

  if (!body.email || !body.password) {
    return c.json({ error: "Email and password are required" }, 400);
  }

  if (body.password.length < 8) {
    return c.json({ error: "Password must be at least 8 characters" }, 400);
  }

  // Check if user already exists
  const existing = await query<{ id: string }>(
    "SELECT id FROM users WHERE email = ?",
    [body.email]
  );

  if (existing.length > 0) {
    return c.json({ error: "Email already registered" }, 409);
  }

  const passwordHash = await Bun.password.hash(body.password);

  await execute(
    "INSERT INTO users (email, password_hash) VALUES (?, ?)",
    [body.email, passwordHash]
  );

  const users = await query<{ id: string }>(
    "SELECT id FROM users WHERE email = ?",
    [body.email]
  );

  // Create session
  const token = crypto.randomUUID();
  const sessionExpiry = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  await execute(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
    [token, users[0]!.id, sessionExpiry]
  );

  return c.json({ token }, 201);
});

auth.post("/login", authRateLimit, async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();

  if (!body.email || !body.password) {
    return c.json({ error: "Email and password are required" }, 400);
  }

  const users = await query<{ id: string; password_hash: string }>(
    "SELECT id, password_hash FROM users WHERE email = ?",
    [body.email]
  );

  if (users.length === 0) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const valid = await Bun.password.verify(body.password, users[0]!.password_hash);

  if (!valid) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  // Create session
  const token = crypto.randomUUID();
  const sessionExpiry = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  await execute(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
    [token, users[0]!.id, sessionExpiry]
  );

  return c.json({ token });
});

auth.post("/logout", requireAuth, async (c) => {
  const header = c.req.header("Authorization");
  const token = header?.slice(7);

  if (token) {
    await execute("DELETE FROM sessions WHERE token = ?", [token]);
  }

  return c.json({ success: true });
});

auth.get("/me", requireAuth, async (c) => {
  const userId = c.get("userId");

  const users = await query<User>(
    "SELECT id, email, name, created_at FROM users WHERE id = ?",
    [userId]
  );

  if (users.length === 0) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({ user: users[0] });
});

export default auth;
