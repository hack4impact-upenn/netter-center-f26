import { parseRSSItems, type FeedItem } from "./parser";
export { parseRSSItems, extractTag } from "./parser";
export type { FeedItem } from "./parser";

const X_API = "https://api.twitter.com/2";

type Tweet = {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
};

type XUserResponse = {
  data: {
    id: string;
    name: string;
    username: string;
  };
};

type XTimelineResponse = {
  data: Tweet[];
  meta?: {
    next_token?: string;
    result_count: number;
  };
};

// --- X (Twitter) API ---

export async function getXUser(username: string): Promise<XUserResponse["data"]> {
  const res = await fetch(`${X_API}/users/by/username/${username}`, {
    headers: {
      Authorization: `Bearer ${process.env.X_BEARER_TOKEN}`,
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`X API error: ${err}`);
  }

  const json = (await res.json()) as XUserResponse;
  return json.data;
}

export async function getXUserTweets(
  userId: string,
  maxResults: number = 10
): Promise<Tweet[]> {
  const params = new URLSearchParams({
    max_results: String(maxResults),
    "tweet.fields": "created_at,author_id",
  });

  const res = await fetch(`${X_API}/users/${userId}/tweets?${params}`, {
    headers: {
      Authorization: `Bearer ${process.env.X_BEARER_TOKEN}`,
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`X API error: ${err}`);
  }

  const json = (await res.json()) as XTimelineResponse;
  return json.data ?? [];
}

// --- RSS Feed ---

export async function fetchRSSFeed(url: string): Promise<FeedItem[]> {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to fetch RSS feed: ${res.statusText}`);
  }

  const xml = await res.text();
  return parseRSSItems(xml);
}

// Pre-configured feeds
export const FEEDS = {
  WSJ: "https://feeds.a.dj.com/rss/RSSWorldNews.xml",
} as const;
