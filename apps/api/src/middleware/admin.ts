import { createMiddleware } from "hono/factory";
import { query } from "../integrations/database";
import type { AppEnv } from "../types";

// Staff-only routes. Must run after requireAuth.
// For now, staff are listed in ADMIN_EMAILS (comma-separated). Swap this for a
// role column once user roles exist.
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const admins = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const users = await query<{ email: string }>("SELECT email FROM users WHERE id = ?", [
    c.get("userId"),
  ]);
  const email = users[0]?.email.toLowerCase();

  if (!email || !admins.includes(email)) {
    return c.json({ error: "Staff access required" }, 403);
  }

  await next();
});
