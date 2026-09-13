# plinth-platform

The Plinth control plane: NestJS backend (api + worker roles), Next.js admin, shared API types.
Architecture, product blueprint and roadmap: [`docs/`](docs/).

## Run locally

Requirements: Node 22 or newer (24 LTS recommended), pnpm 9, Redis on `127.0.0.1:6379`.

```bash
pnpm install
cp backend/.env.example backend/.env        # DATABASE_URL, SESSION_SECRET, GitHub OAuth app
cp admin/.env.example admin/.env.local
pnpm --filter @plinth-pages/backend exec prisma migrate deploy
```

Three processes, three terminals:

```bash
pnpm dev:api      # http://localhost:4000/v1
pnpm dev:worker   # no HTTP — consumes queues
pnpm dev:admin    # http://localhost:3000
```

### One-time: the provisioning GitHub App

The worker creates portfolio repositories as a GitHub App and will not start without one.

1. Start the api and admin, and sign in with a GitHub login listed in `ADMIN_GITHUB_LOGINS`.
2. Dashboard → **Set up GitHub App** (or open `http://localhost:4000/v1/dev/github-app/new`) and confirm on GitHub.
   The App's ID and private key are written into `backend/.env` for you.
3. Install the App on the `plinth-pages` organization with **All repositories**.
4. Start the worker.

## Layout

| Path | What |
|---|---|
| `backend/` | NestJS. `ORCHESTRATOR_ROLE=api` serves HTTP; `=worker` consumes BullMQ queues and talks to GitHub. |
| `admin/` | Next.js — sign-in, role selection, portfolio status; the Web IDE from Phase 4. |
| `packages/shared/` | API contract types, imported with `import type` by both apps. |
| `packages/codemod/` | AST codemod engine — Phase 9. |

## Tests

```bash
pnpm test                                        # unit — no database or network
pnpm --filter @plinth-pages/backend test:int     # integration — real Postgres from backend/.env, fake GitHub
```

## Invariants enforced by tests

- No queue processor may be registered in the api role (`backend/src/architecture/architecture.spec.ts`).
- A missing or blank environment variable stops boot with a message naming it (`backend/src/config/env.spec.ts`).
- One portfolio per user on the free plan, even under concurrent requests — enforced inside a Postgres advisory
  lock (`backend/src/provisioning/provisioning.int-spec.ts`).
- A failed provisioning deletes only a repository generated from our template, never a foreign one.
