import { describe, it, expect, beforeAll, mock } from "bun:test";
import { Hono } from "hono";

// Mock the database integration (used by auth middleware)
mock.module("../../integrations/database", () => ({
  query: mock(() =>
    Promise.resolve([{ user_id: "user-1", expires_at: "2099-01-01" }])
  ),
  execute: mock(() => Promise.resolve()),
}));

// Mock the intake integration
const mockGetXUser = mock(() =>
  Promise.resolve({ id: "123", name: "Test User", username: "testuser" })
);
const mockGetXUserTweets = mock(() =>
  Promise.resolve([
    { id: "t1", text: "Hello world", created_at: "2024-01-01T00:00:00Z" },
    { id: "t2", text: "Second tweet", created_at: "2024-01-02T00:00:00Z" },
  ])
);
const mockFetchRSSFeed = mock(() =>
  Promise.resolve([
    {
      title: "Test Article",
      link: "https://example.com/1",
      description: "A test article",
      pubDate: "Mon, 01 Jan 2024 00:00:00 GMT",
    },
  ])
);

mock.module("../../integrations/intake", () => ({
  getXUser: mockGetXUser,
  getXUserTweets: mockGetXUserTweets,
  fetchRSSFeed: mockFetchRSSFeed,
  parseRSSItems: mock(),
  extractTag: mock(),
  FEEDS: { WSJ: "https://feeds.a.dj.com/rss/RSSWorldNews.xml" },
}));

const authHeader = { Authorization: "Bearer valid-token" };

let app: Hono;

beforeAll(async () => {
  const { default: intakeRoutes } = await import("../intake");
  app = new Hono();
  app.route("/api/intake", intakeRoutes);
});

describe("GET /api/intake/rss", () => {
  it("returns RSS items for a valid URL", async () => {
    const res = await app.request(
      "/api/intake/rss?url=https://example.com/feed.xml",
      { headers: authHeader }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].title).toBe("Test Article");
    expect(mockFetchRSSFeed).toHaveBeenCalledWith(
      "https://example.com/feed.xml"
    );
  });

  it("returns 400 when URL is missing", async () => {
    const res = await app.request("/api/intake/rss", {
      headers: authHeader,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("URL");
  });
});

describe("GET /api/intake/rss/feeds", () => {
  it("returns the preconfigured feeds list", async () => {
    const res = await app.request("/api/intake/rss/feeds", {
      headers: authHeader,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.feeds.WSJ).toBe(
      "https://feeds.a.dj.com/rss/RSSWorldNews.xml"
    );
  });
});

describe("GET /api/intake/x/user/:username", () => {
  it("returns user data for a valid username", async () => {
    const res = await app.request("/api/intake/x/user/testuser", {
      headers: authHeader,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.username).toBe("testuser");
    expect(body.user.id).toBe("123");
  });
});

describe("GET /api/intake/x/user/:userId/tweets", () => {
  it("returns tweets for a user", async () => {
    const res = await app.request("/api/intake/x/user/123/tweets", {
      headers: authHeader,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tweets).toHaveLength(2);
    expect(body.tweets[0].text).toBe("Hello world");
  });

  it("passes limit query param to integration", async () => {
    await app.request("/api/intake/x/user/123/tweets?limit=5", {
      headers: authHeader,
    });

    expect(mockGetXUserTweets).toHaveBeenCalledWith("123", 5);
  });
});

describe("auth protection", () => {
  it("returns 401 without auth header", async () => {
    const res = await app.request("/api/intake/rss/feeds");
    expect(res.status).toBe(401);
  });
});
