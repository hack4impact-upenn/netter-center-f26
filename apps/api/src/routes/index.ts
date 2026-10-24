import { Hono } from "hono";
import auth from "./auth";
import storage from "./storage";
import llm from "./llm";
import payments from "./payments";
import intake from "./intake";

export function registerRoutes(app: Hono) {
  app.route("/api/auth", auth);
  app.route("/api/storage", storage);
  app.route("/api/llm", llm);
  app.route("/api/payments", payments);
  app.route("/api/intake", intake);
}
