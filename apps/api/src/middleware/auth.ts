import { createMiddleware } from "hono/factory";
import { query } from "../integrations/database";
import type { AppEnv, UserRole } from "../types";

type SessionWithRole = {
  user_id: string;
  expires_at: string;
  role: UserRole;
};

/**
 * Validates Bearer token and sets userId + userRole on context.
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("Authorization");

  if (!header || !header.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const token = header.slice(7);

  const sessions = await query<SessionWithRole>(
    `SELECT s.user_id, s.expires_at, u.role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > datetime('now')`,
    [token]
  );

  const session = sessions[0];
  if (!session) {
    return c.json({ error: "Invalid or expired session" }, 401);
  }

  c.set("userId", session.user_id);
  c.set("userRole", session.role);
  await next();
});

/**
 * Must be placed AFTER requireAuth. Rejects non-admin users with 403.
 */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const role = c.get("userRole");
  if (role !== "admin") {
    return c.json({ error: "Admin access required" }, 403);
  }
  await next();
});
