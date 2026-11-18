import { createMiddleware } from "hono/factory";
import { query } from "../integrations/database";
import type { AppEnv } from "../types";

type Session = {
  user_id: string;
  expires_at: string;
};

export function createRequireAuth(
  findSessions = (sql: string, params: unknown[]) => query<Session>(sql, params)
) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const header = c.req.header("Authorization");

    if (!header || !header.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid Authorization header" }, 401);
    }

    const token = header.slice(7);

    const [session] = await findSessions(
      "SELECT user_id, expires_at FROM sessions WHERE token = ? AND julianday(expires_at) > julianday('now')",
      [token]
    );

    if (!session) {
      return c.json({ error: "Invalid or expired session" }, 401);
    }

    c.set("userId", session.user_id);
    await next();
  });
}

export const requireAuth = createRequireAuth();
