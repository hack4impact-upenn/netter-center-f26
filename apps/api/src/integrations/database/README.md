# Database — Cloudflare D1

D1 is Cloudflare's serverless SQL database built on SQLite.

## Setup

1. Install the Wrangler CLI: `bun add -g wrangler`
2. Log in: `wrangler login`
3. Create a database: `wrangler d1 create my-app-db`
4. Copy the database ID from the output into your `.env`:
   ```
   CLOUDFLARE_ACCOUNT_ID=your-account-id
   CLOUDFLARE_API_TOKEN=your-api-token
   D1_DATABASE_ID=your-database-id
   ```

## Getting your API token

1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Create Token → **Custom Token** with these permissions:
   - Account → D1 → Edit
   - Account → Workers Scripts → Edit
   - Account → Cloudflare Pages → Edit
   - Account → R2 Storage → Edit
3. Copy it into `CLOUDFLARE_API_TOKEN`

## Usage

```ts
import { query, execute } from "./integrations/database";

// Create a table
await execute(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Insert a row
await execute(
  "INSERT INTO users (email, name) VALUES (?, ?)",
  ["alice@example.com", "Alice"]
);

// Query rows
const users = await query<{ id: number; email: string; name: string }>(
  "SELECT * FROM users WHERE email = ?",
  ["alice@example.com"]
);
```

## Notes

- D1 uses SQLite syntax — see https://www.sqlite.org/lang.html
- Free tier: 5 million rows read / 100k rows written per day
- Since we're accessing D1 via REST API (not Workers bindings), there's a small network hop — fine for most use cases
