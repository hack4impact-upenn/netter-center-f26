# Web

React + Vite frontend.

## Running

```bash
bun run dev       # Start on :3000
bun run build     # Production build to dist/
bun run preview   # Preview production build
bun run lint      # Type-check
```

## Structure

```
src/
├── main.tsx          # Entry point — React root, router, global styles
├── App.tsx           # Route definitions
├── pages/            # One component per route
│   └── Home.tsx
├── components/       # Reusable UI components
├── hooks/            # Custom React hooks
│   └── useApi.ts     # Data fetching hook
├── services/         # External service clients
│   └── api.ts        # API client (get, post)
├── types/            # TypeScript type definitions
│   └── index.ts
└── styles/
    └── global.css    # Global reset and base styles
```

## API proxy

In development, Vite proxies `/api` requests to the Hono server at `http://localhost:3001`. This is configured in `vite.config.ts`.

In production, set `VITE_API_URL` to your Railway deployment URL before building:

```bash
# apps/web/.env
VITE_API_URL=https://your-api.railway.app
```

## Making API calls

Use the `api.ts` service or the `useApi` hook:

```typescript
// Direct call
import { get, post } from "./services/api";
const data = await get("/api/health");
await post("/api/auth/register", { email: "user@example.com", password: "password123" });

// React hook (auto-fetches on mount)
import { useApi } from "./hooks/useApi";
const { data, loading, error } = useApi("/api/health");
```

## Adding a page

1. Create a component in `src/pages/`
2. Add a route in `src/App.tsx`

## Deployment

Deploy via Cloudflare Pages GitHub integration. Set `VITE_API_URL` as an environment variable in the Pages dashboard. Build command: `cd apps/web && bun install && bun run build`, output directory: `apps/web/dist`.
