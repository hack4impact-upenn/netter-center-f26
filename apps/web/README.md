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
├── main.tsx              # Entry point: router, sample-data store, toasts, global styles
├── App.tsx               # Routes; admins and TAs get different sets
├── pages/                # One component per route
│   ├── Dashboard.tsx     # Admin: totals and per-class progress
│   ├── ReviewQueue.tsx   # Admin: approve or reject uploaded documents
│   ├── Students.tsx      # Admin: every student, filterable by program and course
│   ├── Roster.tsx        # Admin: CSV import
│   ├── Settings.tsx      # Admin: reminders, Box connection, required documents, team
│   └── MyClass.tsx       # TA: status for their own courses
├── components/
│   ├── ui/               # Design-system primitives (Button, Badge, Card, Field, ...)
│   ├── layout/           # Shell, sidebar, workspace switcher
│   ├── DocBadge.tsx      # A document's status as a badge
│   └── StudentTable.tsx
├── data/sample.ts        # Sample records; replace with API calls
├── state/clearance.tsx   # In-memory store over the sample data
├── lib/clearance.ts      # Documents, statuses, progress maths
├── hooks/                # useApi, useHotkey, useTheme
├── services/api.ts       # API client (get, post)
├── types/index.ts
└── styles/
    ├── tokens.css        # Colours, type, motion, light and dark
    └── global.css        # Base styles and component classes
```

The pages run on sample data for now. Use the workspace menu at the top of the sidebar to switch between the admin and TA views.

## Design

The look follows Resend's dashboard, the same system as the Selfphone hub: a black canvas in dark mode (the default, with a light mode toggle in the sidebar), Resend's gray scale, pill-shaped nav and tabs, filled grey fields, tables with a filled header row, and keyboard shortcuts drawn inside buttons.

- Use colours through the tokens in `styles/tokens.css` (`var(--gray-11)`, `var(--interactive)`, ...), never raw hex, so both themes keep working.
- Build with the primitives in `components/ui` before writing new CSS. Add new component classes to `global.css` next to the closest existing one.
- Page titles use `PageHeader`; numbers that matter use the `display` class.
- Every page has to work at 375px wide. Tables scroll sideways inside `.table-wrap`; nothing else should.

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
