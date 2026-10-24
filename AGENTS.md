# AGENTS.md

This file provides context for AI coding assistants (Claude Code, Cursor, GitHub Copilot, ChatGPT, etc.) working in this codebase.

## Project overview

This is a Bun + Turborepo monorepo with two apps and one shared package:

- `apps/api` — Bun + Hono backend with pluggable integrations
- `apps/web` — React + Vite frontend
- `packages/shared` — Shared TypeScript types

## Commands

```bash
bun turbo dev       # Start both apps (web :3000, api :3001)
bun turbo build     # Build all packages
bun turbo test      # Run all tests
bun turbo lint      # Type-check
bun run format      # Format with Prettier
```

API-specific:
```bash
cd apps/api
bun test            # Run API tests
bun run setup       # Create D1 database tables
```

## Architecture

### API (`apps/api`)

**Routes** live in `src/routes/`. Each route file exports a Hono sub-app that gets mounted in `src/routes/index.ts`. All routes use the `/api` prefix.

**Middleware** lives in `src/middleware/`:
- `auth.ts` — `requireAuth` middleware that validates Bearer tokens against the sessions table in D1
- `error.ts` — Global error handler mounted via `app.onError()`
- `logger.ts` — Request logging (method, path, status, duration)

**Integrations** live in `src/integrations/`. Each integration is a folder with:
- `index.ts` — Thin wrapper exporting helper functions
- `README.md` — Setup guide for getting API keys and configuring the integration

Available integrations: database (D1), storage (R2), auth (Resend), llm (OpenRouter), payments (Stripe), intake (X API + RSS).

**Types** — The Hono app uses `AppEnv` from `src/types.ts` for type-safe context variables (e.g., `c.get("userId")` after auth middleware).

**Environment** — All env vars are validated at startup in `src/env.ts`. Required vars cause the server to exit with a clear message. Optional vars log warnings.

### Web (`apps/web`)

**Pages** live in `src/pages/`. Routes are defined in `src/App.tsx`.

**API calls** use `src/services/api.ts` which provides `get()` and `post()` helpers. The `useApi` hook in `src/hooks/` provides React-friendly data fetching.

**Proxy** — In dev, Vite proxies `/api` to `localhost:3001`. In production, `VITE_API_URL` points to the Railway deployment.

## Conventions

### When adding a new API route:
1. Create a file in `apps/api/src/routes/`
2. Use `new Hono<AppEnv>()` for type safety
3. Apply `requireAuth` middleware if the route needs authentication
4. Register it in `src/routes/index.ts`
5. Write tests in a `__tests__/` directory next to the route

### When using an integration:
**IMPORTANT:** Whenever you write code that uses an integration (database, storage, auth, llm, payments, intake), you MUST tell the user that they need to add the corresponding API key to their `apps/api/.env` file if they haven't already. Point them to the integration's README for instructions on where to get the key. Do not assume keys are already configured.

### When adding a new integration:
1. Create a folder in `apps/api/src/integrations/`
2. Export helper functions from `index.ts`
3. Add env vars to `.env.example` and `src/env.ts`
4. Write a `README.md` with setup instructions
5. Keep it thin — expose the actual SDK/API calls, don't over-abstract
6. Tell the user which env vars they need to set and link them to the README

### LLM structured output pattern:
When using the LLM integration for structured data (tags, categories, metadata), use this pattern:
- System prompt requesting a specific JSON format
- Low temperature (0.3) for consistency
- Always wrap `JSON.parse()` in try/catch — LLMs can return malformed JSON
- Have a fallback value if parsing fails

### When adding a frontend page:
1. Create a component in `apps/web/src/pages/`
2. Add a route in `apps/web/src/App.tsx`
3. Use `services/api.ts` or `hooks/useApi.ts` for data fetching

## Testing

Tests use `bun:test`. Test files live in `__tests__/` directories next to the code they test.

**Pure functions** (like RSS parsing, code generation) are tested directly without mocking.

**Route handlers** are tested using Hono's `app.request()` — no HTTP server needed. External integrations are mocked with `mock.module()`.

**What to test:**
- Request validation — bad inputs return 400
- Auth protection — missing/invalid tokens return 401
- Business logic — correct data transformations
- Webhook verification — invalid signatures are rejected

**What NOT to test:**
- Framework behavior (Hono routing, middleware chaining)
- External service responses (mock them instead)

### Important: mock isolation

Bun's `mock.module()` can leak between test files in the same process. If you have pure utility functions that are also re-exported from a mocked module, put them in a separate file (e.g., `parser.ts`, `utils.ts`) and import from there in tests. See `integrations/intake/parser.ts` and `integrations/auth/utils.ts` for examples.

## Building workflow

When building features, follow this order:

1. **Backend first** — Define database schema, build API routes, write tests
2. **Verify** — Run `bun test` and ensure all tests pass
3. **Frontend second** — Build pages that consume the API
4. **Test in browser** — Open DevTools, check Console for errors, check Network tab for failing requests, test on mobile viewport
5. **Commit often** — After every meaningful change, not just at the end

## Code style

- Prettier is configured (`.prettierrc`). Run `bun run format` before committing.
- TypeScript strict mode is enabled in both apps.
- No unused variables or parameters (enforced by tsconfig).
- Keep integration wrappers thin — don't abstract away the underlying SDK.

## Environment variables

All env vars are defined in `apps/api/.env.example`. Required vars are checked at startup. The web app uses `apps/web/.env` with `VITE_` prefix for client-exposed values.

Never commit `.env` files. They are in `.gitignore`.

## Deployment

- **API** → Railway (configured via `railway.toml`)
- **Web** → Cloudflare Pages (via GitHub integration)
- **Database** → Cloudflare D1 (created via `wrangler d1 create`)
- **Storage** → Cloudflare R2 (created via `wrangler r2 bucket create`)
