# webtesting

Connect a GitHub repo and get AI-written tests for it. The platform reads your
React source, generates Vitest + React Testing Library specs with Gemini, runs
them in a Docker sandbox, and reports per-case results, failure explanations
and line coverage.

## Stack

| | |
|---|---|
| Web | Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui |
| Auth | Clerk (wired — GitHub social connection) |
| DB | Postgres 16 via Docker Compose |
| Queue | BullMQ on Redis 7 via Docker Compose |
| ORM | Drizzle |
| AI | Google Gemini (`gemini-2.5-flash`) |
| Sandbox | Docker (`webtesting/node:latest`) |

## What works today

- **GitHub App install** → repos synced into the dashboard (webhook signature verified).
- **Framework detection** — deterministic, reads `package.json`. No AI cost.
- **AI test generation** — 6–10 Vitest + RTL cases per repo, stored as editable test cases.
- **Sandboxed runs** — clone → inject specs under `tests/ai/` → run in Docker → parse
  JUnit back to per-case pass/fail with failure messages and stack traces.
- **Coverage** — v8 line coverage per file, shown on the run detail page.
- **AI failure explanation** — streamed onto failing tests on the run detail page.
- **Legacy push pipeline** — `apps/worker/src/orchestrator.ts` still runs the original
  install/lint/typecheck/test pipeline for `git-push` jobs from the webhook.

### Supported repos

React only, and detection gates on it: `next-app`, `next-pages`, `vite-react`, `cra`,
`remix`. Anything else is detected and reported, but generation and runs are refused.

### Not built yet

- **Browser / E2E tests** — Vitest in happy-dom only. There is no Playwright runner.
- **PR creation** — nothing opens a PR with the generated tests.
- **AI diff review** — changed code is not reviewed.
- **Secrets vault** — the `secrets` table and `SECRET_VAULT_KEY` exist; there is no code.
- **Python / Java / Go** — JS/TS only.

Earlier drafts of a Playwright runner, a PR-opening helper and a diff reviewer were
removed rather than left in place unwired — they described capabilities the platform
did not have. They're in git history if you want them back.

## Prerequisites

- Node 20+ (`nvm use`)
- pnpm 9+
- Docker Desktop (required — runs both the datastores and the test sandbox)

## First-time setup

```bash
# 1. Install dependencies
pnpm install

# 2. Bring up Postgres + Redis
docker compose up -d

# 3. Configure env (see .env.example for what each key is for)
cp .env.example apps/web/.env.local

# 4. Apply database migrations
pnpm db:generate   # writes packages/db/drizzle/ from schema.ts
pnpm db:migrate    # applies migrations to local Postgres

# 5. Build the sandbox image the test runner executes in
pnpm sandbox:build

# 6. Start the dev server
pnpm dev           # Next.js at http://localhost:3000
```

In a second terminal:

```bash
pnpm worker        # BullMQ worker — required for any test run
```

`GEMINI_API_KEY` is required for test generation and failure explanation. The
Clerk and GitHub App keys are required for sign-in and repo sync respectively.

## Layout

```
.
├── apps/
│   ├── web/                 # Next.js app + API routes
│   └── worker/              # BullMQ worker
│       └── src/
│           ├── vitest-runner.ts    # the AI test-case path (current product)
│           └── orchestrator.ts     # the legacy git-push CI path
├── packages/
│   ├── db/                  # Drizzle schema + migrations
│   ├── ai/                  # Gemini wrappers + generated-code sanitizers
│   ├── detector/            # Language detection (legacy path)
│   ├── runners/             # Per-language pipelines (legacy path)
│   └── junit-parser/        # JUnit XML → typed rows
├── docker/node.Dockerfile   # sandbox image
├── docker-compose.yml       # Postgres + Redis for local dev
└── tsconfig.base.json
```

## Useful scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Start Next.js dev server |
| `pnpm worker` | Start the BullMQ worker |
| `pnpm build` | Production build of the web app |
| `pnpm test` | Run unit tests across packages |
| `pnpm typecheck` | Typecheck every workspace package |
| `pnpm db:generate` | Generate SQL migrations from `packages/db/src/schema.ts` |
| `pnpm db:migrate` | Apply migrations to `$DATABASE_URL` |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm sandbox:build` | Build the Node sandbox image used for test runs |

## Notes for contributors

**Generated-code sanitizers.** The model reliably produces a few broken patterns
(nested `<Router>`, wrong relative import depth, `getByText` on text split across
elements). `packages/ai/src/sanitize.ts` is the single source of truth for those
rewrites — it runs at generation time *and* again in the worker, so cases stored
before a rewrite existed heal on their next run. Every rewrite must stay
idempotent; `pnpm test` enforces that.

**Vitest config.** The runner always writes its own `vitest.webtesting.config.ts`
into the clone and passes `--config` explicitly, so a config shipped by the target
repo can neither shadow it nor be clobbered. `coverage.reportOnFailure` must stay
`true` — Vitest discards the whole coverage report on any test failure otherwise.
