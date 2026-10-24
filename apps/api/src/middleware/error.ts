import type { ErrorHandler } from "hono";

export const errorHandler: ErrorHandler = (err, c) => {
  const message =
    err instanceof Error ? err.message : "Internal server error";

  console.error(`Error in ${c.req.method} ${c.req.path}:`, message);

  return c.json({ error: "Internal server error" }, 500);
};
