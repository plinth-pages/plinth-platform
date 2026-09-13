# plinth-platform

The Plinth control plane: NestJS backend (api + worker roles), Next.js admin, shared API types.
Architecture and roadmap: `../plinth/docs/`.

## Run locally

Requirements: Node 20, pnpm 9, Redis on `127.0.0.1:6379`.

```bash
pnpm install
cp backend/.env.example backend/.env        # fill in DATABASE_URL, SESSION_SECRET, GitHub OAuth app
cp admin/.env.example admin/.env.local
pnpm --filter @plinth-pages/backend exec prisma migrate deploy
```

Three processes, three terminals:

```bash
pnpm dev:api      # http://localhost:4000/v1
pnpm dev:worker   # no HTTP — consumes queues
pnpm dev:admin    # http://localhost:3000
```

## Layout

| Path | What |
|---|---|
| `backend/` | NestJS. `ORCHESTRATOR_ROLE=api` serves HTTP; `=worker` consumes BullMQ queues. |
| `admin/` | Next.js — sign-in and dashboard today; the Web IDE from Phase 4. |
| `packages/shared/` | API contract types, imported with `import type` by both apps. |
| `packages/codemod/` | AST codemod engine — Phase 9. |

## Invariants enforced by tests

- No queue processor may be registered in the api role (`backend/src/architecture/architecture.spec.ts`).
- A missing or blank environment variable stops boot with a message naming it (`backend/src/config/env.spec.ts`).
