import { Hono } from "hono";
import { cors } from "hono/cors";
import { validateEnv } from "./env";
import { errorHandler } from "./middleware/error";
import { logger } from "./middleware/logger";
import { registerRoutes } from "./routes";
import { query } from "./integrations/database";
import { startReminderScheduler } from "./jobs/reminders";

validateEnv();

const app = new Hono();

app.use("*", logger);
app.use(
  "*",
  cors({
    origin: process.env.CORS_ORIGIN || "*",
  })
);

app.get("/api/health", async (c) => {
  try {
    await query("SELECT 1");
    return c.json({ status: "ok", db: "connected" });
  } catch {
    return c.json({ status: "degraded", db: "unreachable" }, 503);
  }
});

registerRoutes(app);

app.onError(errorHandler);

if (process.env.RESEND_API_KEY) {
  startReminderScheduler();
}

const port = parseInt(process.env.PORT || "3001");

console.log(`\n✓ API running on http://localhost:${port}\n`);

export default {
  port,
  fetch: app.fetch,
};
