import { createMiddleware } from "hono/factory";

export const logger = createMiddleware(async (c, next) => {
  const start = Date.now();
  const method = c.req.method;
  const path = c.req.path;

  await next();

  const duration = Date.now() - start;
  const status = c.res.status;
  const statusColor =
    status >= 500 ? "\x1b[31m" : status >= 400 ? "\x1b[33m" : "\x1b[32m";

  console.log(
    `${statusColor}${status}\x1b[0m ${method} ${path} ${duration}ms`
  );
});
