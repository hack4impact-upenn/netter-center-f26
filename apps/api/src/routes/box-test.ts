import { Hono } from "hono";
import type { AppEnv } from "../types";
import page from "./box-test/page.html.txt";
import client from "./box-test/client.js.txt";

export function createBoxTestRoutes(
  env: Record<string, string | undefined> = process.env
) {
  const routes = new Hono<AppEnv>();
  if (env.NODE_ENV !== "development" || env.BOX_ENABLE_TEST_PAGE !== "true")
    return routes;

  routes.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cross-Origin-Resource-Policy", "same-origin");
    if (new URL(c.req.url).search) return c.text("Unexpected query parameters", 400);
    await next();
  });

  routes.get("/", (c) => {
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
    );
    return c.html(page);
  });
  routes.get("/client.js", (c) =>
    c.body(client, 200, {
      "Content-Type": "text/javascript; charset=utf-8",
    })
  );
  return routes;
}
