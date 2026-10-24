import { createMiddleware } from "hono/factory";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt < now) store.delete(key);
  }
}, 5 * 60 * 1000);

export function rateLimit(maxRequests: number, windowMs: number) {
  return createMiddleware(async (c, next) => {
    const ip = c.req.header("x-forwarded-for") || "unknown";
    const key = `${ip}:${c.req.path}`;
    const now = Date.now();

    const entry = store.get(key);

    if (!entry || entry.resetAt < now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      await next();
      return;
    }

    if (entry.count >= maxRequests) {
      return c.json({ error: "Too many requests. Try again later." }, 429);
    }

    entry.count++;
    await next();
  });
}
