# Intake — X API + RSS Feeds

Pull external data into your app from X (Twitter) and RSS feeds.

## X (Twitter) API Setup

1. Apply for a developer account at https://developer.x.com
2. Create a project and app in the Developer Portal
3. Generate a **Bearer Token** (read-only access is sufficient)
4. Add to your `.env`:
   ```
   X_BEARER_TOKEN=your_bearer_token
   ```

## Usage

### Track an X account

```ts
import { getXUser, getXUserTweets } from "./integrations/intake";

// Look up a user
const user = await getXUser("elonmusk");
console.log(user.id, user.name);

// Get their recent tweets
const tweets = await getXUserTweets(user.id, 10);
for (const tweet of tweets) {
  console.log(tweet.created_at, tweet.text);
}
```

### Read an RSS feed

```ts
import { fetchRSSFeed, FEEDS } from "./integrations/intake";

// Fetch WSJ world news
const articles = await fetchRSSFeed(FEEDS.WSJ);
for (const article of articles) {
  console.log(article.title);
  console.log(article.link);
  console.log(article.pubDate);
}

// Fetch any RSS feed
const custom = await fetchRSSFeed("https://example.com/feed.xml");
```

### Combine with other integrations

```ts
import { fetchRSSFeed, FEEDS } from "./integrations/intake";
import { execute } from "./integrations/database";

// Store articles in D1
const articles = await fetchRSSFeed(FEEDS.WSJ);
for (const article of articles) {
  await execute(
    "INSERT OR IGNORE INTO articles (title, link, pub_date) VALUES (?, ?, ?)",
    [article.title, article.link, article.pubDate]
  );
}
```

## Notes

- X API free tier: 1,500 tweets read per month — enough for tracking a few accounts
- RSS feeds are free and require no API key
- The RSS parser handles both CDATA-wrapped and plain XML content
- Add more feeds to the `FEEDS` object as needed
