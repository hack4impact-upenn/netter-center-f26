import { createMiddleware } from "hono/factory";
import { query } from "../integrations/database";
import type { AppEnv } from "../types";

type Session = {
  user_id: string;
  expires_at: string;
};

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("Authorization");

  if (!header || !header.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const token = header.slice(7);

  const sessions = await query<Session>(
    "SELECT user_id, expires_at FROM sessions WHERE token = ? AND expires_at > datetime('now')",
    [token]
  );

  if (sessions.length === 0) {
    return c.json({ error: "Invalid or expired session" }, 401);
  }

  c.set("userId", sessions[0].user_id);
  await next();
});
