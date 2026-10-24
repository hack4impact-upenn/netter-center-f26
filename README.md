# Boilerplate

A full-stack monorepo for building and deploying web apps with modern tooling and mostly free services.

## Stack

| Tool | Role |
|---|---|
| Bun | Runtime & package manager |
| Turborepo | Monorepo task runner |
| Hono | API framework |
| React + Vite | Frontend |
| Cloudflare D1 | Database (SQLite) |
| Cloudflare R2 | File storage |
| Resend | Email / auth |
| OpenRouter | LLM |
| Stripe | Payments |
| Railway | API hosting |
| Cloudflare Pages | Web hosting |

## Structure

```
├── apps/
│   ├── api/              # Bun + Hono backend
│   │   ├── src/
│   │   │   ├── routes/         # API route handlers
│   │   │   ├── middleware/     # Auth, error handling, logging
│   │   │   └── integrations/   # Database, storage, auth, llm, payments, intake
│   │   └── scripts/            # Setup & migration scripts
│   └── web/              # React + Vite frontend
│       └── src/
│           ├── pages/          # Route pages
│           ├── components/     # Reusable components
│           ├── hooks/          # Custom React hooks
│           ├── services/       # API client
│           └── types/          # TypeScript types
└── packages/
    └── shared/           # Shared types between web & api
```

## Quick start

```bash
# 1. Click "Use this template" on GitHub to create your own repo, then clone it
git clone https://github.com/YOUR_USERNAME/my-app.git
cd my-app

# 2. Install dependencies
bun install

# 3. Set up environment variables
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env with your API keys

# 4. Create database tables
cd apps/api && bun run setup && cd ../..

# 5. Start development
bun turbo dev
# Web → http://localhost:3000
# API → http://localhost:3001
```

## Commands

| Command | Description |
|---|---|
| `bun turbo dev` | Start web and API in dev mode |
| `bun turbo build` | Build all packages |
| `bun turbo test` | Run all tests |
| `bun turbo lint` | Type-check all packages |
| `bun run format` | Format code with Prettier |

## Integrations

Each integration lives in `apps/api/src/integrations/` with its own `index.ts` (thin wrapper) and `README.md` (setup guide).

| Integration | Provider | What it does |
|---|---|---|
| Database | Cloudflare D1 | SQL queries via REST API |
| Storage | Cloudflare R2 | File upload/download (S3-compatible) |
| Auth | Built-in | Email/password with Bun password hashing |
| LLM | OpenRouter | Chat completions with any model |
| Payments | Stripe | Checkout sessions & webhooks |
| Intake | X API + RSS | Pull external data into your app |

## Deployment

- **API** → Railway (via `railway.toml`)
- **Web** → Cloudflare Pages (via GitHub integration)

See the [build guide](https://guide.droov.info) for step-by-step deployment instructions.
