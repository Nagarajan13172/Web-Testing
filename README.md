# webtesting

CI that runs your tests **and writes the ones you don't have yet**. Connect a GitHub repo, get lint + build + AI-generated tests + AI review on every push.

See the full plan at [`/Users/nagarajan/.claude/plans/hi-buddy-i-need-swirling-donut.md`](../../.claude/plans/hi-buddy-i-need-swirling-donut.md).

## Stack

| | |
|---|---|
| Web | Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui |
| Auth | _Deferred_ — will plug in Clerk (or alternative) once core CI logic works |
| DB | Postgres 16 via Docker Compose |
| Queue | BullMQ on Redis 7 via Docker Compose |
| ORM | Drizzle |
| AI | Anthropic Claude API |

## Prerequisites

- Node 20+ (`nvm use`)
- pnpm 9+
- Docker Desktop

## First-time setup

```bash
# 1. Install dependencies
pnpm install

# 2. Bring up Postgres + Redis
docker compose up -d

# 3. Copy env template (auth is deferred — no third-party keys needed yet)
cp .env.example apps/web/.env.local

# 4. Apply database migrations
pnpm db:generate   # writes packages/db/drizzle/ from schema.ts
pnpm db:migrate    # applies migrations to local Postgres

# 5. Start the dev server
pnpm dev           # Next.js at http://localhost:3000
```

In a second terminal once MVP step 3 ships:

```bash
pnpm worker        # BullMQ worker
```

## Layout

```
.
├── apps/
│   ├── web/                 # Next.js app + API routes
│   └── worker/              # BullMQ worker (stub until step 3)
├── packages/
│   ├── db/                  # Drizzle schema + migrations
│   ├── detector/            # Language detection (stub)
│   ├── runners/             # Per-language pipelines (stub)
│   ├── junit-parser/        # JUnit XML → typed rows (stub)
│   └── ai/                  # Claude wrappers (stub)
├── docker-compose.yml       # Postgres + Redis for local dev
└── tsconfig.base.json
```

## Useful scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Start Next.js dev server |
| `pnpm build` | Production build of the web app |
| `pnpm worker` | Start the BullMQ worker (once implemented) |
| `pnpm db:generate` | Generate SQL migrations from `packages/db/src/schema.ts` |
| `pnpm db:migrate` | Apply migrations to `$DATABASE_URL` |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm typecheck` | Typecheck every workspace package |

## Where we are in the MVP

- [x] **Step 0** — Docker Compose for Postgres + Redis
- [x] **Step 1** — Monorepo skeleton, Next.js app, Clerk wiring, Drizzle schema, landing / dashboard / repo-detail shells
- [ ] **Step 2** — GitHub App install flow + webhook
- [ ] **Step 3** — Worker + BullMQ
- [ ] **Step 4** — JS/TS end-to-end: clone → vitest → JUnit parse → run-detail UI
- [ ] **Step 5** — Secrets vault
- [ ] **Step 6–8** — AI explain / generate / review
- [ ] **Step 9–10** — Python, Java, Go support

Follow-up prompts to drive each step live at the bottom of the plan file.
