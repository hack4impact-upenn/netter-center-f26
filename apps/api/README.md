# API

Bun + Hono backend with pluggable integrations.

## Running

```bash
bun run dev       # Start with hot reload on :3001
bun test          # Run all tests
bun run setup     # Create D1 database tables
bun run lint      # Type-check
```

## Structure

```
src/
├── index.ts              # App entry — middleware, routes, server
├── env.ts                # Environment variable validation
├── types.ts              # Hono app types (AppEnv)
├── schema.sql            # Database table definitions
├── routes/
│   ├── index.ts          # Route registration
│   ├── auth.ts           # /api/auth — login, verify, session
│   ├── database.ts       # /api/db — raw query (admin)
│   ├── storage.ts        # /api/storage — file upload/download
│   ├── llm.ts            # /api/llm — chat, ask
│   ├── payments.ts       # /api/payments — checkout, webhooks
│   └── intake.ts         # /api/intake — X API, RSS feeds
├── middleware/
│   ├── auth.ts           # Bearer token verification via D1
│   ├── error.ts          # Global error handler
│   └── logger.ts         # Request logging
└── integrations/
    ├── database/         # Cloudflare D1
    ├── storage/          # Cloudflare R2
    ├── auth/             # Resend email
    ├── llm/              # OpenRouter
    ├── payments/         # Stripe
    └── intake/           # X API + RSS
```

## Adding a new route

1. Create a file in `src/routes/`:

```typescript
import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

const myRoute = new Hono<AppEnv>();
myRoute.use("*", requireAuth);

myRoute.get("/", async (c) => {
  const userId = c.get("userId");
  return c.json({ userId });
});

export default myRoute;
```

2. Register it in `src/routes/index.ts`:

```typescript
import myRoute from "./myRoute";
app.route("/api/my-route", myRoute);
```

## Adding a new integration

1. Create a folder in `src/integrations/` with `index.ts` and `README.md`
2. Add any required env vars to `.env.example` and `src/env.ts`
3. Import and use it from your routes

## Auth flow

The API uses email/password auth with Bun's built-in password hashing:

1. Client registers via `POST /api/auth/register` with email + password
2. Server hashes password with `Bun.password.hash()` (argon2id), creates user in D1
3. Server creates a session token, returns it
4. Client includes `Authorization: Bearer <token>` on subsequent requests
5. `requireAuth` middleware validates the token against D1
6. Client logs in via `POST /api/auth/login` — server verifies hash, returns new session
7. Client logs out via `POST /api/auth/logout` — server deletes session

No external service required. Resend can be added optionally for email notifications.

## Testing

Tests use `bun:test` and live in `__tests__/` directories alongside the code they test. External services are mocked with `mock.module()`.

```bash
bun test                    # Run all
bun test --watch            # Watch mode
bun test src/routes/__tests__/auth.test.ts  # Specific file
```

## Deployment

The API deploys to Railway via `railway.toml` at the repo root. Set all `.env` variables in Railway's dashboard using the RAW Editor. Railway sets `PORT` automatically.
