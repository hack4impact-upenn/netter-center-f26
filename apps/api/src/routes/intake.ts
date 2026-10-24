import { Hono } from "hono";
import {
  getXUser,
  getXUserTweets,
  fetchRSSFeed,
  FEEDS,
} from "../integrations/intake";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

const intake = new Hono<AppEnv>();

intake.use("*", requireAuth);

intake.get("/x/user/:username", async (c) => {
  const username = c.req.param("username");
  const user = await getXUser(username);
  return c.json({ user });
});

intake.get("/x/user/:userId/tweets", async (c) => {
  const userId = c.req.param("userId");
  const limit = parseInt(c.req.query("limit") || "10");
  const tweets = await getXUserTweets(userId, limit);
  return c.json({ tweets });
});

intake.get("/rss", async (c) => {
  const url = c.req.query("url");

  if (!url) {
    return c.json({ error: "URL query parameter is required" }, 400);
  }

  const items = await fetchRSSFeed(url);
  return c.json({ items });
});

intake.get("/rss/feeds", (c) => {
  return c.json({ feeds: FEEDS });
});

export default intake;
