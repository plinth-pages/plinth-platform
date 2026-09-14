# DEVELOPMENT PHASES — Plinth

> **Version:** 2.0 — written from scratch. Supersedes every earlier version of this document.
> **Architecture:** Sandbox Web IDE + AST Codemods — see the five rules in `PRODUCT_BLUEPRINT.md` §0
> **Structure:** 16 phases (0–15), each ending in something that runs
> **Date:** September 2026

---

## Read this first

### The estimate, computed from the table below

| Path | Phases | Working days | At 5 days/week |
|---|---|---|---|
| **Path B — spine demo** (no integrations) | 0–8, 15 | **41–55** | **8–11 weeks** |
| **Path A — full MVP** | 0–15 | **65–86** | **13–17 weeks** |

These totals exclude buffer. Add 20% for the unknowns that E2B, GitHub and Vercel will
produce.

> **A correction to the previous version of this file:** its headline estimates ("4–5 weeks",
> "8–10 weeks") did not add up to its own phase table, which summed to considerably more. The
> numbers above are the sum of the durations listed, and nothing else.

### Why it is this long

This is not one system. It is six, and each is a real engineering project:

1. A **provisioning** system that creates private repositories and Vercel projects on a user's behalf
2. A **sandbox** system that runs, pauses, wakes and rebuilds a dev server per portfolio
3. A **safety net** that stages, validates and type-checks every change before it reaches the preview
4. An **AST codemod engine** that edits other people's React code deterministically
5. An **AI co-pilot** whose tools route every write through the safety net
6. An **integration platform**: packages, a catalogue, credentials and an install pipeline

### Two paths

**Path B** proves the core loop — sign in, get a real repo and a live sandbox, change it by
conversation, publish to production — with no integrations. **Path A** adds the codemod engine and
the integration platform.

Path B's phases are a strict prefix of Path A's. **Nothing is thrown away by shipping Path B first**,
provided Phase 1 builds the full slot contract (it does). Recommendation: ship Path B, then continue.

### Verification gates

Three external facts can invalidate a phase's design. Each must be checked **before** that phase
starts, not during it.

| Gate | Check | Blocks |
|---|---|---|
| **G1** | E2B: pricing, maximum session length, pause/resume availability, concurrency limits on the intended plan | Phase 3 |
| **G2** | E2B: whether a sandbox's public preview URL can require a token | Phase 4 |
| **G3** | Vercel: plan support for private repos owned by a GitHub organisation; disabling automatic deployments per branch | Phase 6 |

### G1 result — checked 2026-09-13

**Verdict: pass for the demo, on the Hobby plan only.** Sources: e2b.dev/pricing, docs.e2b.dev/billing,
docs.e2b.dev/sandbox/persistence.

| Fact | Hobby | Pro |
|---|---|---|
| Monthly fee | $0 | **$150** (≈ ₹13,000 — more than the whole budget on its own) |
| Free credit | $100, **one-time** | none |
| Compute | $0.000014 / vCPU-second · $0.0000045 / GiB-second | same |
| Max continuous runtime | **1 hour** | 24 hours |
| Concurrent sandboxes | 20 | 100+ |
| Max per sandbox | 8 vCPU · 8 GiB RAM · 10 GiB disk | 8+ · 8+ · 20+ |
| Billing when paused | none — "billing stops immediately" | same |
| Pause / resume | ~4 s per GiB of RAM to pause · ~1 s to resume · runtime limit **resets** on resume | same |
| Paused sandbox retention | kept **indefinitely**, no auto-kill | same |

**Cost of one Plinth sandbox** (`next dev` plus type-checking): 2 vCPU + 2 GiB ≈ **$0.133/hour (≈ ₹12)**;
2 vCPU + 4 GiB ≈ $0.166/hour (≈ ₹15). The $100 credit alone covers roughly **600–750 editing hours**; a demo with
20 users editing 3 hours a month uses about 60.

**What this changes in Phase 3:**
1. **Stay on Hobby.** Pro's fee alone exceeds the budget. Revisit only with revenue.
2. **The 1-hour runtime cap is designed around, not hit.** The lifecycle manager pauses and immediately resumes a
   sandbox that reaches 50 minutes of continuous runtime (resuming resets the clock). Keep sandbox RAM at 2 GiB if it
   runs the template, because pause time grows with RAM — that interruption is visible to an active user.
   (Measured in Phase 3: a 2 GiB pause takes 0.5 s and the resume 0.4 s.)
3. **Destroying paused sandboxes is our job.** E2B never expires them, so the 24-hour destroy sweep is required,
   not a nicety.
4. **Cost alarm from day one** on sandbox-seconds per day, since the credit is one-time.

**Open questions — resolved 2026-09-13, live against the project's Hobby account:**

| Question | Answer | Evidence |
|---|---|---|
| Does pause/resume work on Hobby? | **Yes.** Pause 1.2 s, resume 0.5 s (512 MiB sandbox). Files, a background loop and a running HTTP server (same pid) all survived. | live probe |
| Does resume reset the runtime clock? | **Yes — and to `connect()`'s timeout, which defaults to 5 minutes.** The driver must always pass `timeoutMs` when resuming. | `endAt` before/after |
| Is the 1-hour cap enforced? | **Yes.** A 2-hour timeout is rejected: `400: Timeout cannot be greater than 1 hours`. | live probe |
| Can usage continue past the $100 credit on Hobby? | **Yes, by adding a payment method** — no forced upgrade. Without one the account is blocked. A **spending limit** can be set on the dashboard budget page. | docs.e2b.dev/billing |
| Are paused snapshots charged for storage? | **Not per E2B's docs** — "billing stops immediately" on pause; no storage charge listed. Plinth still destroys long-paused sandboxes, since the repo is the source of truth. | docs.e2b.dev/billing |

**Further findings that change Phase 3:**
- **The default `base` template is unusable for a Next.js preview:** 2 vCPU, **512 MiB RAM**, Node **20.9**, no pnpm.
  Phase 3 builds a custom template (Node 24, pnpm, 2 GiB, pnpm store pre-warmed from `plinth-template`).
- **The default lifecycle is `onTimeout: kill`.** Plinth creates sandboxes with `onTimeout: pause`, so a missed
  rotation pauses instead of discarding the running dev server.
- **Port traffic is public by default:** `https://3000-<id>.e2b.app` answered 200 with no auth header. Resolved by gate G2 below.
- **A paused sandbox returns 502 to traffic** and stays paused (`autoResume` defaults to false). Wake-on-request is
  therefore Plinth's job: the IDE heartbeat resumes it.
- **Idle pause is shortened to 5 minutes by default** (configurable), at the owner's request, to keep compute cost
  down; resuming is sub-second, so an aggressive idle timeout costs the user almost nothing.

### G2 result — checked 2026-09-13

**Verdict: pass, with a Plinth proxy in front.** E2B can make port traffic private; a browser cannot send the
credential itself, so the IDE reaches previews through Plinth.

| Question | Answer | Evidence |
|---|---|---|
| Can a preview URL require a credential? | **Yes.** `Sandbox.create({ network: { allowPublicTraffic: false } })` makes every port answer **403** unless the request carries the sandbox's `e2b-traffic-access-token` header. | live probe |
| Which forms of the token work? | **Only that header.** A wrong token, a `?e2b-traffic-access-token=` query string and `Authorization: Bearer` all get 403. Websocket upgrades accept the header too. | live probe |
| Is the token stable? | **Yes**, across pause/resume and repeated `connect` calls (64 characters, returned as `sandbox.trafficAccessToken`). | live probe |
| Can an iframe use it directly? | **No.** Browsers can't attach custom headers to an iframe navigation, and a cookie would be third-party inside the IDE. | — |

**What was built (before Phase 4):**
- Every sandbox is created with public traffic disabled; its token is stored in `sandboxes.traffic_token`. A sandbox
  created earlier (no token) is destroyed and rebuilt on the next visit.
- A **preview proxy** (api process, port 4100) serves each preview on its own hostname —
  `http://<label>.preview.localhost:4100` locally — and forwards to the sandbox with the token added. A whole origin
  per preview means Next.js works unmodified: absolute asset paths, routing and the hot-reload websocket.
- The label is a **capability**: 130 random bits, one per owner and portfolio, stored in Redis and **extended only by
  the owner's authenticated heartbeat**. It stops working 15 minutes after the editor closes, so a leaked link goes
  dead on its own. No cookies are involved, so it works in the IDE's iframe and in a new tab alike.
- The proxy never returns the token, strips the platform session cookie and the referer, and adds
  `frame-ancestors 'self' <admin>`, `X-Robots-Tag: noindex` and `Referrer-Policy: same-origin`.
- A request to a sleeping preview gets a "Waking…" page that retries, and queues a resume. A 502 from E2B (paused by
  its own deadline, or the dev server died) also queues `ensure` immediately.
- **Production needs** wildcard DNS and a wildcard certificate for the preview domain (`*.preview.<domain>`).
  Settings: `PREVIEW_PROXY_PORT`, `PREVIEW_URL_TEMPLATE`.

**Verified live:** the raw sandbox URL returns 403; the preview link serves the page, its assets and the HMR websocket;
a guessed label gets 410; another user gets 404.

### G3 result — checked 2026-09-14

**Verdict: blocked on a decision, not on engineering.** Source: vercel.com/docs/git/vercel-for-github and Vercel's
community answers on Hobby and organisations.

| Question | Answer |
|---|---|
| Can a Hobby team deploy a **private** repository owned by a **GitHub organisation**? | **No.** Hobby deploys private repos only from a personal account. Private org repos need **Pro** ($20/member/month). |
| Is Hobby allowed for this use? | Hobby is for personal, non-commercial projects; a platform hosting other people's sites is commercial use. |
| Can automatic deployments be disabled for `draft`? | Yes: `git.deploymentEnabled.draft: false` in `vercel.json` (already in the template). |
| Is there a path without the Git integration? | Yes: build and upload with the Vercel CLI (`vercel build` + `vercel deploy --prebuilt --prod`) using a token. It sidesteps the org restriction, but not the terms of use. |

**Options:** (a) Vercel Pro — about ₹1,700/month, fits the budget alongside E2B's free tier; (b) CLI deploys from the
worker on a token — no Git integration needed, same Pro question for commercial use; (c) another host with an API
(e.g. Cloudflare Pages or Netlify).

**Decision (2026-09-14, owner): stay on Vercel Hobby for now and provision public repositories.**
`PORTFOLIO_REPO_VISIBILITY=public` (default `private`) sets the visibility of *new* portfolio repositories; flipping it
to `private` after moving to Vercel Pro needs no code change. Repositories that already exist keep their visibility.
With public repositories the `draft` branch is publicly readable too; secrets never live in the repository
(`.env*` is ignored, and credentials arrive via the vault in Phase 12).

---

## Phase overview

| # | Phase | Days | Path | Repos |
|---|---|---|---|---|
| **PART 1 — Foundations** |||||
| 0 | Platform scaffold: NestJS, admin, database, queue, auth | 3–4 | A B | platform |
| 1 | `@plinth-pages/core`, slot contract, and the base template | 5–7 | A B | packages, template |
| 2 | GitHub App and private repository provisioning | 3–4 | A B | platform |
| **PART 2 — Sandbox and IDE** |||||
| 3 | E2B sandbox driver and lifecycle | 6–8 | A B | platform |
| 4 | Web IDE shell: preview, code viewer, live events | 3–4 | A B | platform |
| **PART 3 — Safety net and publish** |||||
| 5 | **The safety net: staged operations engine** | 6–8 | A B | platform, packages |
| 6 | Publish: `draft` → `main` → Vercel production | 3–4 | A B | platform |
| **PART 4 — Co-pilot** |||||
| 7 | AI co-pilot core: file tools through the safety net | 5–7 | A B | platform |
| 8 | Onboarding and first portfolio — **Path B milestone** | 3–4 | A B | platform |
| **PART 5 — Codemods and integrations** |||||
| 9 | **AST codemod engine** | 5–7 | A | platform |
| 10 | Integration packages and catalogue | 4–5 | A | packages, platform |
| 11 | Install, uninstall and move pipeline | 5–6 | A | platform |
| 12 | Credentials and secret-backed integrations | 3–4 | A | platform, packages |
| 13 | Co-pilot integration tools and requests | 3–4 | A | platform |
| **PART 6 — Productisation** |||||
| 14 | Plans, limits and super admin | 4–5 | A | platform |
| 15 | Landing page and production launch | 4–5 | A B | platform |

**Critical path: 1 → 5 → 9.** The slot contract, the safety net and the codemod engine. If any of the
three is weak, nothing above it can be trusted. Everything else can be shortened; these cannot.

### Repositories

| Repository | Created | Contains |
|---|---|---|
| `plinth-platform` | Phase 0 | `backend/` NestJS (api + worker), `admin/` Next.js, `packages/shared`, `packages/codemod` |
| `plinth-packages` | Phase 1 | `@plinth-pages/core`; integration packages from Phase 10 |
| `plinth-template` | Phase 1 | The starting portfolio; a GitHub template repository |
| `portfolio-<slug>` | Phase 2 onward | One per portfolio, private, in the platform organisation |

### What carries over from earlier work

An early prototype app (since removed) built ten portfolio sections, a Zod content schema and a theme engine. In
Phase 1 these become the template's `components/sections/*.tsx` and `content/*.ts`. That work is kept.

---

# PART 1 — FOUNDATIONS

## PHASE 0 — Platform scaffold

**Goal.** A NestJS backend running as both an API and a worker from one codebase, a Next.js admin
authenticating against it with GitHub, Postgres migrated, and a queue proven end to end.

**Why now.** Everything is orchestrated from here.

**Depends on.** Nothing.

### What you build

**Monorepo** (`plinth-platform`, pnpm workspaces)
```
backend/            NestJS
admin/              Next.js (App Router, Tailwind)
packages/shared/    API contract types used by both
packages/codemod/   empty until Phase 9
```

**Two process roles from one codebase**
```
ORCHESTRATOR_ROLE=api     HTTP controllers only
ORCHESTRATOR_ROLE=worker  BullMQ processors, crons, sandbox sweeps
```
Add an architecture test that fails if a queue processor or cron is registered when the role is `api`.
A processor leaking into the API tier runs once per API instance — a bug that only appears in
production.

**Configuration.** Every environment variable declared and validated at boot. A missing variable
crashes at startup, never silently at request time.

**Database** (Postgres + Prisma). Initial tables: `users`, `portfolios`, `sandboxes`, `operations`,
`deployments`, `integrations`, `installed_integrations`, `credentials`, `conversations`, `messages`.
Add columns as phases need them; do not design every column now.

**Queue.** Redis + BullMQ. Prove it with a trivial job enqueued by the API and executed by the worker.

**Auth.** GitHub OAuth. The backend issues a session in an httpOnly cookie; capture the GitHub `login`.
Roles `user | admin`; a guard for `/admin/*` routes.

### What you learn
NestJS modules and dependency injection · BullMQ · why API and worker tiers are separated · OAuth ·
cookie sessions across two apps.

### Definition of done
- [ ] Backend boots in both roles; the architecture test fails if a processor is registered in `api`
- [ ] A job enqueued over HTTP is executed by the worker process
- [ ] GitHub sign-in works from the admin; `githubLogin` is stored
- [ ] A non-admin receives 403 on an admin route
- [ ] Both apps import types from `packages/shared`
- [ ] A missing environment variable fails boot with a clear message

### Not in this phase
GitHub repositories, sandboxes, any integration code.

**Duration: 3–4 days**

---

## PHASE 1 — `@plinth-pages/core`, the slot contract, and the base template

**Goal.** Two repositories. `plinth-packages` publishes `@plinth-pages/core` — the `Slot` component and the slot
vocabulary — and `@plinth-pages/check`, the `plinth check` validator. `plinth-template` is a good-looking portfolio whose
`app/page.tsx` and `app/layout.tsx` contain every slot, and whose CI enforces the contract.

**Why now.** Every generated repository is a copy of this template, frozen at the moment it is
generated. The codemod engine (Phase 9) targets these slots, and the safety net (Phase 5) runs this
validator. **This is the most expensive phase to get wrong.**

**Depends on.** Phase 0 (only for the GitHub organisation).

### What you build

**`@plinth-pages/core`**
```
Slot.tsx          <Slot name="afterProjects">{children}</Slot>
                  renders children; emits data-plinth-slot="<name>" for the IDE and health checks
slots.ts          SLOT_NAMES — the frozen vocabulary, with a version number
plinth-json.ts    Zod schema for plinth.json
```

**`@plinth-pages/check`** (separate package, installed as a devDependency — it bundles the TypeScript compiler via
ts-morph, which must not become a production dependency of every portfolio)
```
check.ts          checkSources() — pure, called directly by the safety net
cli.ts            `plinth check [--json] [--cwd]`
```

**The vocabulary** — freeze it now:
`head`, `bodyEnd`, `providers` (in `app/layout.tsx`); `heroAfter`, `beforeProjects`, `afterProjects`,
`sidebar`, `beforeContact`, `contact`, `footer` (in `app/page.tsx`).
Adding a slot later is safe. Renaming one is a fleet-wide migration.

**`plinth check`** parses `app/page.tsx` and `app/layout.tsx` with ts-morph and fails if:
- a vocabulary slot is missing, or appears more than once
- a `<Slot>` has a name outside the vocabulary
- a slot's children do not match the integrations `plinth.json` places there
- the `// plinth:imports:start … end` region does not match the installed packages
- a `{/* plinth:<id>:start */}` marker is unpaired

Output is machine-readable (`--json`), because the safety net and the co-pilot both parse it.

**`plinth-template`**
```
app/layout.tsx              head, bodyEnd, providers slots
app/page.tsx                composes sections; seven slot call sites; empty imports region
components/sections/*.tsx   raw React + Tailwind — ported from the existing plinth app
content/*.ts                profile, projects, experience, skills, theme
plinth.json                 { "coreVersion": "0.1.0", "integrations": [] }
.prettierrc                 formatting is part of the contract (see Phase 9)
tsconfig.json               strict: true, skipLibCheck: true
vercel.json                 disables automatic deployments for the draft branch  (confirm under G3)
.github/workflows/ci.yml    pnpm install --frozen-lockfile · plinth check · tsc --noEmit · next build
```
Mark the repository as a **template repository**, private, in the platform organisation.

**Publish** `@plinth-pages/core@0.1.0` and `@plinth-pages/check@0.1.0`. Until they are on npm, the template installs them
from packed tarballs in `vendor/`, so its lockfile and CI work without a registry.

### What you learn
ts-morph and the TypeScript AST · designing a validator other tools depend on · publishing a package ·
why frozen copies make a contract expensive to change.

### Definition of done
- [ ] A fresh clone of the template passes CI
- [ ] Deleting a slot fails `plinth check` with the slot's name in the error
- [ ] Duplicating a slot fails
- [ ] Adding a JSX element inside a slot without a matching `plinth.json` entry fails
- [ ] Changing Tailwind classes outside every slot passes
- [ ] The page looks genuinely good at 375, 768 and 1440 px, light and dark
- [ ] The template contains no integration-specific code

### Not in this phase
Any integration package. Any codemod.

**Duration: 5–7 days**

---

## PHASE 2 — GitHub App and private repository provisioning

**Goal.** Signing up and choosing a role produces a private `portfolio-<slug>` repository with `main`
and `draft` branches, exactly once, even under concurrent requests.

**Why now.** The sandbox (Phase 3) clones this repository.

**Depends on.** Phases 0–1.

### What you build
- **GitHub App** installed on the platform organisation — repository administration and contents
  permissions only. Mint short-lived installation tokens per operation; never store them.
- **Generate from template** with `private: true`, then create `draft` from `main`.
- **Provisioning service**
  - advisory lock keyed on the user; re-check state inside the lock
  - **plan limit checked inside the lock** (one free portfolio)
  - idempotent: if the repository already exists, adopt it
  - status: `provisioning → ready | failed`
  - compensation: a later failure deletes what was created
- **Recovery job:** retries portfolios stuck in `provisioning`
- **Rate limits:** GitHub's secondary rate limit returns `422` with no retry guidance. Back off, throttle
  bulk work, and never let one leave a portfolio permanently `failed`.

### What you learn
GitHub Apps versus OAuth apps · installation tokens · advisory locks · idempotent, compensating workflows.

### Definition of done
- [ ] Sign-up creates a private repository with `main` and `draft`
- [ ] Two concurrent provisioning requests for one user produce one repository
- [ ] A second portfolio on the free plan is refused, including via a direct API call
- [ ] A simulated mid-provision failure cleans up
- [ ] A portfolio stuck in `provisioning` is completed by the recovery job

### Not in this phase
The Vercel project — created lazily at first publish (Phase 6), so sign-ups that never publish cost nothing.

**Duration: 3–4 days**

---

# PART 2 — SANDBOX AND IDE

## PHASE 3 — E2B sandbox driver and lifecycle

**Gate G1 must pass before this phase starts.**

**Goal.** For any portfolio, `ensure()` returns a running `next dev` on the `draft` branch at a public
URL; idle sandboxes pause and wake; destroyed ones rebuild from GitHub with no loss.

**Why now.** It is the preview, the co-pilot's filesystem, and where the safety net runs.

**Depends on.** Phase 2.

### What you build

**A custom E2B template (image):** Node LTS, pnpm, git, and a pnpm store pre-populated from the
template's lockfile. This makes `pnpm install` a hard-link operation instead of a download, and is the
biggest lever on cold-start time.

**The driver interface**
```ts
interface SandboxDriver {
  ensure(portfolioId): Promise<{ sandboxId: string; previewUrl: string }>;
  pause(portfolioId, reason): Promise<void>;
  resume(portfolioId): Promise<void>;
  destroy(portfolioId, reason): Promise<void>;
  restartDevServer(portfolioId): Promise<void>;
  health(portfolioId): Promise<"healthy" | "starting" | "unreachable">;
  exec(portfolioId, cmd, opts): Promise<ExecResult>;
  readFile / writeFile / listFiles
}
```
One implementation: `E2BDriver`. The interface exists so a self-hosted driver stays possible if G1
reveals a budget problem.

**Conformance tests** that call every method with every parameter and assert the driver received them.
TypeScript lets a class implement a method with *fewer* parameters than the interface declares and still
compile — a driver that drops a `reason` or `symptom` argument cannot make the right decision, and the
compiler will not tell you.

**`ensure()`**
1. connect to an existing sandbox, or create one from the template
2. clone the repository and check out `draft` — the installation token is passed per command and
   **never written into the git remote**
3. write `.env.local` from the credential vault (empty until Phase 12)
4. `pnpm install --prefer-offline`
5. start `next dev` on `0.0.0.0:3000` as a background process
6. poll until the dev server responds; return the preview URL

**Lifecycle**
- The IDE sends a heartbeat; `sandboxes.last_accessed_at` is updated
- Pause after idle; destroy after long inactivity (thresholds from G1)
- Wake on request: an IDE visit to a paused sandbox resumes it
- Recovery ladder for unhealthy: restart `next dev` → clear `.next` → destroy and rebuild. **An
  unreachable preview means "restart first", never "rebuild first".**
- **Before pausing or destroying, confirm nothing is waiting to be pushed** (see Phase 5)
- Record sandbox minutes per portfolio for plan limits and cost tracking

### What you learn
The E2B SDK · process management in a remote VM · lifecycle state machines · why interfaces need
conformance tests.

### Definition of done
- [x] `ensure()` serves the portfolio at a public URL
- [x] Editing a file inside the sandbox hot-reloads the preview
- [x] A paused sandbox resumes with its workspace intact
- [x] A destroyed sandbox rebuilds from `draft` with nothing lost
- [x] The git remote in the sandbox contains no token
- [x] Conformance tests fail when a method drops a parameter
- [x] Cold start and warm resume times are measured and recorded
- [x] Sandbox minutes are recorded per portfolio (as seconds)

### Not in this phase
Any mutation logic — that is the safety net's job.

**Duration: 6–8 days**

### As built — 2026-09-13

**Verified live** against E2B Hobby and `plinth-pages/portfolio-sumitverma77`, through the real api and worker
(21/21 checks). The measurements below are the Phase 3 baseline.

| Measurement | Result |
|---|---|
| Cold start (open → dev server answering) | **19–22 s**: create 1.3 s · clone ~4.5 s · `pnpm install` from the warm store ~4 s · `next dev` ready + first compile ~10 s |
| Pause (2 GiB) / resume | 0.5 s / **0.4 s**; the preview answers ~2 s after resume |
| Dev server restart (recovery rung 1) | ~5 s |
| Memory in use with `next dev` running | ~950 MiB of 2 GiB |
| Paused preview | 502 from E2B until woken |
| Framing | no `X-Frame-Options` or CSP from E2B or `next dev`, so the IDE can use an iframe |

**Custom template** `plinth-portfolio` (`backend/scripts/build-e2b-template.js`, `pnpm e2b:template`): `node:24`,
pnpm 9.15.9, git, 2 vCPU / 2 GiB, and a pnpm store pre-filled with `pnpm fetch` from `plinth-template`'s lockfile and
vendored tarballs. Builds in ~30 s. Rebuild it whenever the template's dependencies change.

**Where the design differs from the sketch above:**
- **The driver is addressed by the provider's sandbox id, not the portfolio id.** It knows E2B and nothing about the
  database; `SandboxLifecycle` maps portfolios to sandboxes, decides when to pause, and meters. `create` and
  `bootstrap` are separate so the sandbox id is saved before the slow part — a crash cannot leak a running sandbox.
  `extend` and `info` were added for the idle deadline and reconciliation.
- **Conformance is enforced twice.** `DRIVER_METHOD_ARITY` is typed from the interface, so it stops compiling when a
  signature changes; the test compares each implementation's `Function.length` with it, and includes a driver that
  drops `reason` to prove the check fails. Behavioural tests assert that every argument reaches the E2B SDK.
  Consequence: driver methods must not use default parameters.
- **A paused sandbox is never resumed by accident.** `Sandbox.connect` resumes a paused sandbox, so every driver
  operation checks the state first and throws `SandboxNotRunningError`; only `resume()` connects to a paused one.
- **The token travels only in the clone command's environment** (`GIT_CONFIG_COUNT` / `http.extraheader`). Clone
  URLs with credentials are rejected, and error output is redacted.
- **Idle pause is two-layered.** The api records `last_accessed_at` on every heartbeat (the IDE sends one every 30 s
  while the tab is visible). A sweep every minute pauses anything idle for 5 minutes, rotates anything that has run
  for 50, destroys anything paused for 24 hours, and moves E2B's own deadline to 2 minutes after the idle pause is
  due. If the worker is down, E2B pauses the sandbox itself at that deadline (`onTimeout: pause`), so an idle
  sandbox cannot run up cost.
- **Wake on request goes through the queue.** The api never talks to E2B: a heartbeat on a sandbox that isn't
  running queues `ensure`, and the worker resumes it. Job ids are per portfolio and kind, so repeated heartbeats are
  no-ops.
- **One operation per sandbox at a time** via a Redis lock (15-minute TTL). A job that finds it taken is delayed
  3 s without spending an attempt; the sweep skips it until the next tick.
- **Bootstrap failures do not retry.** A repository that fails to install or start fails the same way again, so the
  sandbox is destroyed and the error (with the tail of the log) is shown with **Try again** and **Rebuild**.
  Infrastructure errors retry up to 3 times.
- **Metering is per second** (`seconds_used`), capped at E2B's deadline when E2B paused the sandbox first.
- **Not done yet:** pushing pending changes before pause/destroy (nothing is written in the sandbox until Phase 5),
  and a daily cost alarm (Phase 14). Preview URLs were public at this point; gate G2 made them private before Phase 4.

**Settings** (worker env, defaults shown): `E2B_TEMPLATE=plinth-portfolio`, `SANDBOX_IDLE_PAUSE_MINUTES=5`,
`SANDBOX_DESTROY_AFTER_PAUSED_HOURS=24`, `SANDBOX_ROTATE_AFTER_MINUTES=50`.

---

## PHASE 4 — Web IDE shell

**Gate G2 must be checked before this phase starts.**

**Goal.** The editor screen: live preview, a read-only code viewer, sandbox status, and a real-time event
channel — with empty slots waiting for the co-pilot and integrations.

**Depends on.** Phase 3.

### What you build
- **Layout:** co-pilot column (placeholder), Preview and Code tabs, side panels for Integrations, Slots
  and Settings (placeholders)
- **Preview:** an iframe onto the sandbox URL; device widths resize the iframe, so real CSS breakpoints fire
- **Sandbox status chip:** starting / running / waking / unhealthy, with a Restart action
- **Code tab:** file tree and a read-only, syntax-highlighted viewer. Files are served by a backend
  endpoint that reads from the sandbox and **refuses** `.env*`, `.git/` and `node_modules/`
- **Live events:** a server-sent events stream from the backend for sandbox and (from Phase 5) operation events
- **Dashboard:** the portfolio card with status and repository link

### Definition of done
- [x] The editor shows the running sandbox
- [x] A file changed in the sandbox updates the iframe without a manual reload
- [x] The code viewer cannot open `.env.local`, even by URL manipulation
- [x] A paused sandbox shows "Waking" and recovers on its own
- [x] Device widths trigger real responsive layouts
- [x] Below tablet width, the IDE shows a "use a larger screen" message

**Duration: 3–4 days**

### As built — 2026-09-13

The editor is at `/portfolios/:id`; the dashboard card links to it. Verified against the real api, worker and E2B
(28/28 backend checks) and in Chromium.

- **Layout:** top bar (repository, `draft`, status chip, Restart, Open preview) · co-pilot column (placeholder, hidden
  below 1024 px) · Preview / Code tabs · side panels **Slots**, **Integrations**, **Settings**.
- **Preview:** the iframe loads the preview link from gate G2. Desktop fills the space; Tablet and Mobile set the
  iframe's real width (768 / 390 px, so the portfolio's own breakpoints fire) and scale it down when the column is
  narrower. The frame reloads whenever the preview comes back, so it never keeps showing an error from while it slept.
- **Status:** Connecting / Starting / Waking / Live / Paused / Stopped / Needs attention. The editor sends a heartbeat
  every 30 s while the tab is visible and wakes a paused preview as soon as it notices. Measured: after E2B paused the
  sandbox, the editor went Paused → Waking → Live in **3 s** once the pause was detected.
- **Live events:** `GET /v1/portfolios/:id/events` (SSE). The worker publishes on Redis
  (`plinth:portfolio-events:<id>`) whenever a sandbox's status changes; one subscriber connection in the api fans out
  to open editors. Events are hints to refetch; polling (3 s while busy, 20 s otherwise) covers a dropped stream.
- **Code tab:** a file tree from `git ls-files --cached --others --exclude-standard` and a read-only viewer with syntax
  highlighting (`prism-react-renderer`) and line numbers. Files up to 512 KB; binary files are not shown. Deep links:
  `?tab=code&file=app/page.tsx`.
- **Refusal rules** (`workspace-policy.ts`) are enforced on the api **and** again on the worker against the file's real
  path after resolving symlinks: `.env*`, `.git/`, `node_modules/`, `.next/`, `.vercel/`, `.turbo/`, `.npmrc`,
  `*.pem|key|p12|pfx`, absolute paths, `..` and backslashes. Verified: `.env.local`, `app/../.env.local`, `%2e%2e/`,
  an absolute path and a symlink to `.env.local` all return 403, including through the editor's URL.
- **Reads go through the worker.** The api has no E2B credentials, so it queues a job on the `workspace` queue
  (concurrency 16, separate from sandbox starts) and waits for the answer.
- **Slots panel — the start of the codemod UI.** Lists the ten slots from the `@plinth-pages/core` the portfolio has
  installed, grouped by file, with what `plinth.json` places in each. Clicking a slot opens its file with the
  `<Slot>` line marked. **Run plinth check** runs the contract validator in the sandbox (~2 s).
- **Integrations panel** explains that installs arrive with the safety net; there are no install buttons yet.
  Installing anything is a code change, and Rule 4 means no code change ships before Phase 5.
- **Below 768 px** the editor isn't mounted at all, so a phone never keeps a sandbox awake.
- **Hot reload through the proxy, measured in Chromium:** changing `content/profile.ts` in the sandbox updated the
  page's `<h1>` without a reload (same document).

---

# PART 3 — SAFETY NET AND PUBLISH

## PHASE 5 — The safety net: staged operations engine

**Goal.** Every mutation to a portfolio — whatever produces it — runs as an **operation**: queued,
locked, applied in a staging worktree, formatted, validated by `plinth check`, type-checked with `tsc`,
and either applied to the live tree and pushed to `draft`, or discarded without the preview ever
seeing it.

**Why now.** Rule 4. It is built **before** anything that mutates code, so that neither the codemod
engine nor the co-pilot ever has an unsafe write path, even temporarily.

**Depends on.** Phases 1 and 3.

### The operation model

```
operations
  id · portfolio_id · type (edit | install | uninstall | move | theme | fleet_update | publish)
  actor (user | copilot | system) · status · input · diff · check_output
  attempts · commit_sha · started_at · finished_at

status:  queued → staging → checking → applying → applied
                                    └─→ rejected   (failed checks; nothing applied)
                             applied └─→ reverted   (render health check failed)
                                  any └─→ failed    (infrastructure error)
```

One operation at a time per portfolio, enforced by a lock. Operations queue; the IDE shows the queue.

### The algorithm

```
sandbox layout:
  /home/user/app              live tree — next dev serves this
  /home/user/.plinth/staging  staging worktree — created per operation

 0. PRECONDITION   live tree is clean, HEAD equals origin/draft
                   (if not: stop, alert — this indicates a bug elsewhere)
 1. STAGE          git worktree add -B plinth/op-<id> ../.plinth/staging HEAD
 2. DEPENDENCIES   dependency change → pnpm install in staging (hard links from the store)
                   otherwise → link staging/node_modules to the live tree's
 3. MUTATE         write files / run the codemod / pnpm add
 4. FORMAT         prettier --write on every touched file
 5. VALIDATE       plinth check --json
 6. TYPE-CHECK     tsc --noEmit --incremental  (build info kept between operations)
 7. REJECT         any failure →
                     git worktree remove --force; delete branch
                     status = rejected; store parsed errors (file, line, message)
                     live tree untouched → preview never changed
 8. APPLY          all pass →
                     commit in staging with an Operation-Id trailer
                     live tree: git merge --ff-only plinth/op-<id>
                     dependencies changed → pnpm install --frozen-lockfile --offline in live tree
                     next dev hot-reloads
                     git push origin draft
                     remove worktree
 9. HEALTH CHECK   request the preview's affected routes;
                   non-2xx or Next's error overlay present →
                     git revert --no-edit HEAD; push; status = reverted
```

**Why a worktree, and not "apply, check, then revert":** a file written into the live tree is picked up
by `next dev` immediately, so the user sees the broken intermediate state before any revert. Checking in
a separate worktree is the only way to guarantee the preview never renders a change that failed.

### Pushing, and not losing work
- A push failure after a successful local apply is retried with backoff; the portfolio is marked
  **pending push**
- Publish is blocked while a push is pending
- **The lifecycle manager (Phase 3) must flush pending pushes before pausing or destroying a sandbox.**
  This is the one path by which work could be lost; test it deliberately.

### Performance budget
Measure p50 and p95 for steps 5–6 on the real template. Target: **under 10 seconds p50** for a
single-file edit. `skipLibCheck` and incremental build info are the main levers.

### A development-only edit endpoint
`POST /dev/portfolios/:id/edit { path, content }` runs an `edit` operation. It lets you exercise the net
fully before the codemod engine or co-pilot exist. Remove it before launch.

### What you learn
Git worktrees · designing for atomicity · parsing compiler output · health checks · why "undo" is
harder than "don't".

### Definition of done
- [x] An edit with a type error is **rejected**, and a poller on the preview during the operation never
      observes the error
- [x] The live tree's HEAD is unchanged after a rejection
- [x] A valid edit is applied, hot-reloads, is committed with an Operation-Id trailer and pushed to `draft`
- [x] An edit deleting a slot is rejected by `plinth check`
- [x] An edit that type-checks but throws at render is **reverted** by the health check
- [x] Two operations submitted together run one after the other
- [x] Destroying a sandbox with a pending push flushes the push first
- [x] Killing the sandbox mid-operation leaves `draft` on GitHub consistent and the next `ensure()` clean
- [x] Check duration p50 and p95 are recorded per operation

### As built — 2026-09-13

Verified live on a throwaway portfolio (provisioned, exercised, and its repository deleted afterwards) through the
real api, worker, E2B sandbox and GitHub: **23/23 checks**.

| Measurement (2 vCPU sandbox, the base template) | Result |
|---|---|
| `plinth check` + `tsc --noEmit`, in parallel | p50 **2.2 s**, p95 3.0 s |
| Whole operation, queued → applied (includes push and health check) | p50 **10.8 s**, p95 14.0 s |

**The two checks.** `pnpm exec tsc --noEmit --incremental` (the project's own TypeScript — equivalent to
`npx tsc --noEmit`, without `npx` ever downloading a different version) and `pnpm exec plinth check --json`. Both
run in the staging worktree, in parallel. Either failing rejects the change; unparseable output from either also
rejects it, so a broken checker can never pass a change.

**Where "revert the commit" happens.** A change that fails a check is never committed to the live tree, so there is
nothing to revert: the worktree is discarded and `draft` on GitHub never sees it. The only change that reaches the
live tree and is then undone is one that passes both checks but breaks rendering; that one is undone with a real
`git revert` commit (carrying the same `Operation-Id` trailer) and pushed.

**How it's wired.**
- `operations` queue, one job per operation; the job drains the portfolio's **oldest** queued operation while holding
  the same Redis lock as the sandbox lifecycle, so a sweep can never pause a sandbox mid-operation and operations never
  interleave. A job that finds the lock taken, or the sandbox asleep, waits without spending an attempt.
- The driver gained workspace roots: `live` (`/home/user/app`, served by `next dev`) and `staging`
  (`/home/user/.plinth/staging`, outside the dev server's view). The runner only ever writes to `staging`.
- Staging shares the live tree's `node_modules` through a symlink unless the change touches `package.json` or the
  lockfile, in which case it installs from the warm pnpm store.
- Commits are authored by the GitHub App's bot account (`<slug>[bot]`), never by a person.
- A failed push leaves the change applied and sets `sandboxes.pending_push`; a `push` job retries with backoff. The
  next operation pushes it first, an idle pause tries to, and **destroying a sandbox refuses to proceed until the push
  succeeds** (resuming a paused sandbox to do it).
- When an operation or a code-viewer read finds its sandbox paused or gone while the database still says running, it
  queues `ensure` immediately. Found by the live test: without this, a sandbox killed mid-operation stayed "running"
  in the database until the next sweep, and the editor couldn't read files for up to a minute. Measured with the fix:
  a rebuild starts about 4 s after the sandbox dies.
- An operation interrupted by a crashed worker is settled on the next run: `applied` if its trailer is in the live
  history, `failed` otherwise. A leftover worktree is removed by the next stage.
- Every status change is published as an `operation` event on the existing SSE stream.
- `POST /v1/dev/portfolios/:id/edit` (development only) submits an edit; `GET /v1/portfolios/:id/operations` lists
  history with p50/p95 timings.
- Health check: the affected routes (always `/`, plus any page file touched) are requested twice after the fast-forward;
  a 5xx, no response, or Next's error document means the change broke rendering. Errors that only happen in the
  browser after hydration are not detected yet.

**Editor.**
- While an operation is queued or running, the preview is **blurred, non-interactive and covered by "Working on it…"**
  with the current step. It stays covered ~1 s after the operation finishes, so hot reload repaints before it is seen.
- If a change is rejected, reverted or fails, the preview is uncovered and a toast says **"This change couldn't be
  applied safely"**, with the errors behind *Show details*. After a revert the frame is reloaded as well.
- Settings shows recent changes with their check times and the p50/p95, and — for admins, in development — **Test the
  safety net** buttons that submit a valid edit, a type error, a slot deletion and a render crash.


### Not in this phase
Codemods and co-pilot tools — they arrive later as new operation types on this engine.

**Duration: 6–8 days**

---

## PHASE 6 — Publish: `draft` → `main` → Vercel production

**Gate G3 must pass before this phase starts.**

**Goal.** Publish promotes `draft` to `main`, which triggers a Vercel production deployment to
`<slug>.plinth.dev`. A failed build leaves the previous deployment live.

**Depends on.** Phase 5.

### What you build
- **Vercel project**, created at first publish: linked to the repository, production branch `main`,
  automatic deployments disabled for `draft`, environment variables synced from the vault
- **Slug claim** on first publish: reserved-word list, uniqueness, `<slug>.plinth.dev` attached to the project
- **Publish runs as an operation** (it takes the portfolio lock, so it can never race an edit)
  1. pre-flight: no pending push · `plinth check` · `next build` in a staging worktree — catching
     build-only failures before Vercel does
  2. `git push origin draft:main` — always a fast-forward, because only Publish writes `main`
  3. track the Vercel deployment until it is terminal
- **A deployment is never retried automatically.** A retry can race and publish the wrong commit.
- **Unpublished changes** = commits on `draft` not on `main`, shown on the Publish button
- **Publish demotion:** after success, pause an idle sandbox
- **Unpublish:** detach the domain; repository and `draft` untouched

### Definition of done
- [x] Publish produces a live site — at `<repo>.vercel.app` for now; `<slug>.plinth.dev` needs a domain
- [x] Edits after publishing do not change the live site (`main` stays where it was)
- [x] Editing on `draft` does not trigger a Vercel build (verified live)
- [x] A deliberately broken build fails pre-flight, before `main` or any host is touched
- [ ] A build that fails on Vercel leaves the previous deployment serving — Vercel's behaviour; tracked as `failed` (integration-tested), not yet reproduced live because pre-flight catches build failures first
- [x] Publish waits for a running operation rather than interleaving with it
- [x] The unpublished-changes count is correct

### As built — 2026-09-14 (promotion to main; hosting pending G3)

Verified live on a throwaway portfolio through the real api, worker, sandbox and GitHub: **15/15 checks**.
Production build in the sandbox: **17 s**; whole publish: **21 s**. `POST /publish` answers in
**0.7 s** — the work happens in the worker.

- **Publish is an operation** (`type: publish`) on the same queue and lock as edits: it waits for an edit submitted
  before it, and an edit submitted during it waits for it. Pressing Publish again while one is queued or running
  returns the same operation.
- **Steps:** push any unpushed commit to `draft` → fetch `main` and require a fast-forward (if `main` has commits
  `draft` doesn't, stop rather than overwrite) → in a worktree of that exact commit, run `plinth check` and
  `next build` (type-check and lint included) → `git push origin <sha>:refs/heads/main`, never forced → record a
  `deployments` row.
- **Nothing to publish** is a successful no-op. **A failed build** is `rejected` with the build's errors (lint errors
  are parsed with file, line and rule) and `main` is untouched. **A refused push** is `failed` and is not retried:
  a delayed retry could publish a different commit than the one that was built.
- Publishing never touches the live tree, so the preview isn't covered while it runs.
- `GET /v1/portfolios/:id/publish` — unpublished-changes count (GitHub compare `main...draft`, read by the worker so
  it works while the sandbox sleeps), draft and main shas, pending push, the publish in progress, the last deployment.
- **Editor:** a **Publish** button in the top bar with the unpublished count; while publishing it shows the step
  (Preparing, Building, Publishing). A toast reports **Published** or **Couldn't publish** with the build errors.
- Edit-check p50/p95 exclude publish builds.
- **Not built yet:** slug claiming and a custom domain (`<slug>.plinth.dev`), unpublish, syncing environment variables
  from the vault, and pausing an idle sandbox after publishing.

### Vercel deployments — added 2026-09-14

Enabled by `VERCEL_TOKEN` (worker). Without it, everything above still works and deployments are `unconfigured`.

1. **Before `main` moves** (after the pre-flight build passes), the worker makes sure the portfolio has a Vercel project:
   `GET /v9/projects/<repo-name>`, else `POST /v11/projects` with `framework: nextjs` and
   `gitRepository: { type: github, repo: <org>/<repo> }`. The id is stored in `portfolios.vercel_project_id`. A project
   with that name linked to a different repository is never reused. **If Vercel can't reach the repository, the
   publish fails and `main` does not move** — the message says what to fix.
2. **After the push**, a `deployments` row is created as `pending` and a `track-deployment` job follows it, outside the
   portfolio lock, so editing continues while Vercel builds:
   - Vercel normally starts a production deployment from the push to `main` itself; the job finds it with
     `GET /v7/deployments?projectId&target=production&sha`.
   - If none appears within 45 s (for example the very first push after the project was linked), the job starts one for
     the exact commit: `POST /v13/deployments` with `target: production` and
     `gitSource: { type: github, org, repo, ref: main, sha }`.
   - It polls `GET /v13/deployments/:id` every 5 s: `BUILDING` → `building`; `READY` → `ready` with the live URL (the
     shortest production alias, `<project>.vercel.app`); `ERROR`/`CANCELED` → `failed` with Vercel's message. Vercel
     keeps serving the previous production deployment when a build fails. After 20 minutes it is recorded as failed.
3. **Editor:** "Deploying…" next to Publish while Vercel builds, a **Live ↗** link to the last successful deployment
   (it stays even if a later deployment fails), and a toast — "Your site is live" with the link, or "The deployment
   failed" with Vercel's error.
4. `draft` is never deployed: the template's `vercel.json` sets `git.deploymentEnabled.draft: false`.

**Setup (once):** create a Vercel token; install the Vercel GitHub app on the `plinth-pages` organisation with access to
all repositories; keep `PORTFOLIO_REPO_VISIBILITY=public` while on Hobby. **Verified live 2026-09-14 (11/11)** on a throwaway public portfolio, Vercel Hobby, personal account: project
created and linked to `plinth-pages/<repo>` with production branch `main`; Vercel started the production deployment
from the push to `main` itself (found by commit sha, so no second deployment was started); **pending → building →
ready in 54 s**; the published commit served at `https://<repo>.vercel.app` with HTTP 200 and the edited content; a
later change pushed to `draft` created no deployment and left the live site unchanged. End to end from Publish to live:
pre-flight build 15 s + Vercel 54 s.

**Duration: 3–4 days**

---

# PART 4 — CO-PILOT

## PHASE 7 — AI co-pilot core

**Goal.** The user types "make the hero darker and add these projects", and the co-pilot edits the raw
React, Tailwind and content files — as one operation, through the safety net — while the chat shows
exactly what it did.

**Depends on.** Phases 4 and 5.

### What you build

**Tools**

| Tool | Behaviour |
|---|---|
| `list_files`, `read_file`, `search` | Read the sandbox; deny list applies |
| `edit_file(path, search, replace)` | Targeted edits, not whole-file rewrites — smaller diffs, fewer tokens |
| `apply_theme(preset)` | Edits `content/theme.ts` |
| `check` | Runs `plinth check` + `tsc` on the pending changes without applying |
| `ask_user` | Asks a clarifying question |

**One operation per turn.** Edits accumulate in the turn's pending change set and run through the safety
net together, so a multi-file request applies entirely or not at all.

**Retry within the turn.** When the net rejects, the parsed errors are returned to the model, which may
revise and resubmit — **at most three attempts**. After that the change is discarded and the co-pilot
explains what it tried.

**Tool-level enforcement — not prompt instructions**
- Deny read and write: `.env*`, `.git/`, `node_modules/`
- Deny write: `plinth.json`, `package.json`, lockfiles
- **Slot interiors and the imports region:** `edit_file` checks whether a replacement overlaps a
  `<Slot>` body or the imports region, and refuses with a redirect — *"Integrations are placed with
  `move_integration`"* (available from Phase 13). `plinth check` still backstops this.
- Scrub tool output for anything resembling a secret before it reaches the model

**Context** the model receives: file tree, `plinth.json`, the slot vocabulary, the rules above. Not the
whole repository.

**Chat UI:** streaming responses; an **operation card** per turn showing status, a one-line summary and
a diff link.

**Built-in intents**
- *Paste résumé* — a tuned prompt that populates `content/*.ts`
- *Undo last change* — a revert operation for the previous applied commit, through the net

**Metering:** tokens per user; daily message limit enforced server-side.

### Definition of done
- [ ] "Make the hero darker" changes Tailwind in the Hero component and the preview updates
- [ ] A pasted résumé populates projects, experience and skills
- [ ] An edit the model gets wrong is rejected, retried, and either applied or clearly explained
- [ ] The co-pilot cannot read `.env.local` by any tool, path trick or search
- [ ] An attempt to edit inside a slot is refused by the tool, before the net
- [ ] "Undo last change" restores the previous state
- [ ] The daily message limit is enforced by the backend

**Duration: 5–7 days**

---

## PHASE 8 — Onboarding and first portfolio · **Path B milestone**

**Goal.** Sign in → pick a role → watch named provisioning steps → land in the IDE with a portfolio
already populated from the GitHub profile.

**Depends on.** Phases 2, 3, 6, 7.

### What you build
- **Role selection** — one click, never restricts anything
- **Provisioning progress** streamed over the event channel as real steps: *creating repository →
  starting preview → installing → personalising*. The repository link appears the moment it exists.
- **Personalisation as a system operation:** GitHub profile plus role starting content written into
  `content/*.ts` through the safety net — the net dogfooded from the very first change
- **First-turn chips:** "Paste your résumé", "Make it dark", "Show my best repos"
- **Routing:** a returning user goes straight to their portfolio; a failed provisioning shows a real
  error and a retry

### Definition of done
- [x] A new user reaches a populated, running portfolio with visible progress throughout
- [x] The personalisation commit appears on `draft` as an ordinary operation
- [x] A failure during provisioning is recoverable from the UI
- [x] Different roles produce visibly different starting content
- [ ] **End-to-end:** sign up → edit by conversation → publish → live URL, with no manual intervention

> **As built:** onboarding is role → look (light/dark, accent) → setup. Progress is polled from real state
> (`GET /portfolios/:id/setup`). The repository link is not shown: customer-facing UI hides GitHub.

**Path B: continue to Phase 15.**

**Duration: 3–4 days**

---

# PART 5 — CODEMODS AND INTEGRATIONS

## PHASE 9 — AST codemod engine

**Goal.** A pure library — source text in, source text out — that adds, moves and removes an
integration's import and JSX inside locked slots, deterministically, on both pristine template code
and heavily co-pilot-edited code.

**Why now.** Rule 3. Built as its own phase, against fixtures, before any installation UI depends on it.

**Depends on.** Phases 1 and 5.

### What you build (`plinth-platform/packages/codemod`)

```ts
addImport(src, { pkg, named })                     → src
insertIntoSlot(src, { slot, integrationId, jsx })   → src
removeFromSlot(src, { slot, integrationId })        → src
moveIntegration(src, { integrationId, from, to })   → src
renameSlot(src, { from, to })                       → src   // fleet migrations only
```

**Anchoring.** Locate `<Slot name="…">` JSX elements by name — never by surrounding code, line numbers
or indentation. This is what makes codemods robust to a co-pilot that has restyled everything around them.

**Markers.** Each integration's JSX sits between `{/* plinth:<id>:start */}` and `{/* plinth:<id>:end */}`;
imports sit inside the `plinth:imports` region. Removal deletes exactly the marked range.

**Props are data, never code.** Values from manifests and user input (a LeetCode username, say) are
emitted as escaped **string, number or boolean literals only**. A username such as
`"} /><script>` must become an escaped string literal, never JSX or code. This is the codemod engine's
injection-vulnerability boundary; test it explicitly.

**Formatting.** Prettier runs on the output. Because the template and every co-pilot edit are also
formatted, diffs stay minimal and reviewable.

**Idempotency.** Inserting an integration already present in a slot is a no-op that reports as such.

**Integration with the safety net.** A codemod operation reads files from the staging worktree, transforms
them in the worker, writes them back, and continues at step 4 of Phase 5.

### Tests
- **Golden fixtures** from `plinth-template` at a tagged version
- **Adversarial fixtures:** slots wrapped in extra `div`s, sections reordered, conditional rendering near
  slots, comments and blank lines everywhere, Tailwind rewritten throughout
- **Round trip:** insert then remove returns byte-identical, formatted source
- **Escaping:** hostile prop values become inert string literals
- Every output passes `plinth check` and `tsc` on the fixture project

### Definition of done
- [ ] All operations pass golden and adversarial fixtures
- [ ] Insert → remove is byte-identical after formatting
- [ ] Hostile prop values cannot produce executable code
- [ ] Two integrations in one slot keep a stable, deterministic order
- [ ] Every codemod output passes `plinth check`

**Duration: 5–7 days**

### As built — 2026-09-14
- **API** (`@plinth-pages/codemod`, TypeScript compiler API + text splices, no reprinting): `installIntegration`,
  `uninstallIntegration`, `moveIntegration` over the three portfolio files (`app/layout.tsx`, `app/page.tsx`,
  `plinth.json`), plus the primitives `addImport`, `removeImport`, `insertElement`, `insertProvider`, `removeBlock`,
  `listBlocks`. `renameSlot` is deferred until fleet updates are built (post-MVP).
- **Props** are rendered as `name={JSON.stringify(value)}` — finite numbers, booleans and strings only; reserved names
  (`children`, `key`, `ref`, `dangerouslySetInnerHTML`, `style`, `className`, `on*`) are refused. Prettier keeps the
  braces, e.g. `username={"octocat"}`.
- **Order:** imports sorted by package inside `plinth:imports`; blocks in a slot sorted by integration id; providers
  go in the `wrap={[…]}` array with the same markers.
- **Failures** are typed `CodemodError`s (`SLOT_NOT_FOUND`, `SLOT_DUPLICATE`, `MARKERS_CORRUPT`, …) and surface as
  `source: "codemod"` rejections. Prettier is loaded lazily, so the worker never loads it.
- **Tests:** 52 (golden, adversarial, round trip, determinism, escaping, failures).

---

## PHASE 10 — Integration packages and catalogue

**Goal.** `@plinth-pages/leetcode-stats` and `@plinth-pages/github-stats` are published to npm; the catalogue lists
them; the marketplace renders a configuration form from each manifest.

**Depends on.** Phase 1.

### What you build
- **`@plinth-pages/integration-types`** — the manifest's Zod schema: `id`, `name`, `category`, `version`,
  `defaultSlot`, `allowedSlots`, `props`, `secrets`, `files`
- **Package conventions:** React and Next as peer dependencies; ESM; explicit client/server boundaries;
  data fetched server-side with caching; each package ships `plinth.manifest.json`
- **First packages:** LeetCode Stats and GitHub Stats (public identifiers; server-side fetching with
  revalidation, so rate limits apply per deployment rather than per visitor)
- **Catalogue:** `integrations` table, populated by reading the manifest from the published package
  version; super-admin activation
- **Marketplace UI:** browse, category filters, role-based recommendations first, detail view showing
  the **exact npm package and version** it installs, a form generated from `props`
- **Live validation** of props (for example, the LeetCode username exists) through the backend

### Definition of done
- [ ] Both packages install and render in a scratch Next.js project
- [ ] Each manifest passes schema validation in CI
- [ ] The catalogue lists both, with a working form and live validation
- [ ] A manifest referencing a slot outside the vocabulary is rejected at ingestion

**Duration: 4–5 days**

### As built — 2026-09-14
- **Not on npm yet.** Packages are vendored: `integrations/<id>/<package>-<version>.tgz` in this repository. The worker
  ingests them at start-up (`CatalogueIngest`), reading `package.json` and `plinth.manifest.json` from inside the
  tarball; a manifest must validate, name the tarball's own package and version, and use its directory as its id.
  Installing copies the tarball to the portfolio's `vendor/` and depends on `file:vendor/<tgz>`. When publishing to
  npm, drop the tarball: the planner falls back to the exact version.
- **API:** `GET /v1/integrations` (catalogue + planned + the user's requests), `POST /v1/integrations/:id/validate`
  (manifest rules, then a cached existence check against GitHub / LeetCode; an unreachable source never blocks).
- **Planned integrations and requests** (pulled forward from Phase 13): a static list of ~40 not-yet-built
  integrations (`planned-integrations.ts`). `POST /v1/integrations/requests` records one vote per user per
  integration in `integration_requests` (typed suggestions are slugged, so "Notion Pages!" and "notion pages" count
  once; installable ones are refused; 50 per account), `DELETE …/requests/:key` withdraws.
  `GET /v1/admin/integration-requests` ranks them for the super admin (`/admin/requests` in the admin app).
- **Editor → Integrations panel:** search, category filters, *On your portfolio* (Move / Remove, live pending
  status), *Ready to install* (role recommendations first, exact `package@version`, slot picker limited to
  `allowedSlots`, a form generated from `props` with live validation), *Coming soon* with **Request**, and a
  free-text "Don't see it?" request.

---

## PHASE 11 — Install, uninstall and move pipeline

**Goal.** Clicking Install produces a real dependency and a real, type-checked diff in the user's repository,
visible in the preview within about a minute — and uninstalling removes every trace.

**Depends on.** Phases 5, 9, 10.

### What you build

**Install** (`type: install`)
```
pnpm add <package>@<exact version>          in staging
codemod: addImport + insertIntoSlot         (Phase 9)
write manifest `files`, if any
update plinth.json
→ safety net steps 4–9
```

**Uninstall** (`type: uninstall`) — codemod removal, delete the files recorded in `plinth.json`,
`pnpm remove`, update `plinth.json` → safety net.

**Move** (`type: move`) — `moveIntegration`, checked against the manifest's `allowedSlots` → safety net.

**Slots panel:** every slot and its contents; move an integration with a slot picker.

**Plan limit** on installed integrations, enforced inside the operation.

### Failure modes — test each
| Case | Expected |
|---|---|
| Package version not published | Rejected at `pnpm add`; nothing changed |
| Network failure during `pnpm add` | Failed; staging discarded; retryable |
| Package with broken type definitions | Rejected by `tsc`; flagged as a **package bug** |
| Codemod cannot find the slot | Rejected; flagged as a **codemod or template bug** |
| Install an already-installed integration | No-op |
| Uninstall something not installed | No-op |

### Definition of done
- [ ] Install appears in the preview, with a diff in the Code tab and a commit on `draft`
- [ ] The live site is unchanged until Publish
- [ ] Uninstall leaves the repository byte-identical to before the install
- [ ] Move relocates the component and respects `allowedSlots`
- [ ] Every failure mode behaves as listed
- [ ] Codemod-caused rejections are recorded separately from other rejections

**Duration: 5–6 days**

### As built — 2026-09-14
- **Planner** (`IntegrationPlanner`, worker): after staging, reads the three portfolio files and `package.json` from
  the staging worktree, runs the codemod, sets or removes the dependency (key order preserved so removal is exact),
  and returns `noop` / `reject` / `change`. The runner writes the vendored tarball (`vendor` step), writes the files,
  and continues with the unchanged safety net: install + format → `plinth check` ∥ `tsc` → apply → push → render check.
  The `installed_integrations` table is updated in the same transaction as success, never on a revert.
- **Dependencies are linked before the code lands.** Found live: fast-forwarding `app/page.tsx` before
  `pnpm install` linked the package made Next compile a `Module not found` and the render check reverted a good
  install. `applyScript` now installs the new manifest into the live tree first, then merges; `revertScript` does the
  same in reverse. A package that can't be linked rejects the operation before the preview changes.
- **API** (`/v1/portfolios/:id/integrations`): `GET` installed + pending, `POST` install (catalogue, slot, props, live
  check, already installed → 409, limit of 5 → 409), `PATCH /:integrationId` move, `DELETE /:integrationId` remove —
  each queues an operation and returns 202. The worker re-checks slot and limit against the repository itself.
- **Failure modes:** codemod → `source: "codemod"`; disallowed slot, unknown integration, plan limit, unlinkable
  package → `source: "install"`; already installed / not installed / same slot → applied no-op without a commit.
- **Live check** (throwaway public repo, real E2B + GitHub, deleted afterwards): install GitHub Stats 24.9 s (checks
  2.8 s) with live GitHub data in the preview; LeetCode Stats alongside it 22.3 s; move 15.9 s; both removed in
  44 s; net diff against the pre-install commit empty — `pnpm-lock.yaml` and `vendor/` included; `main` never moved.

---

## PHASE 12 — Credentials and secret-backed integrations

**Goal.** A Contact Form integration that sends email using the user's own provider key — which never
enters the repository, the bundle, the admin UI or the co-pilot.

**Depends on.** Phases 6 and 11.

### What you build
- **Vault:** AES-256-GCM, a unique IV per secret, a key identifier to allow rotation
- **Smoke test before saving:** a real, harmless call to the provider; an invalid key is rejected at entry
- **Sync**
  - sandbox: rewrite `.env.local`; restart `next dev` if required
  - production: upsert the Vercel project's environment variables as sensitive values
- **`@plinth-pages/contact-form`:** a client form component, plus a manifest `files` entry that writes
  `app/api/plinth/contact/route.ts` — a server route reading the key from the environment, with spam
  protection
- **`@plinth-pages/visitor-counter`:** zero-config. Note: it stores counts through a Plinth endpoint, making it a
  **documented exception** to the "portfolio does not depend on us" principle; it must render gracefully
  with no count if the endpoint is unavailable
- **Disconnect:** delete the secret; remove it from both environments
- **Verification:** grep the built client bundle for the secret value in CI

### Definition of done
- [ ] A contact form submitted on a published portfolio delivers email
- [ ] The secret is absent from the repository, client bundle, admin responses and model context
- [ ] An invalid key is rejected before it is saved
- [ ] Disconnecting removes the secret everywhere
- [ ] Visitor Counter renders correctly when its endpoint is down

**Duration: 3–4 days**

---

## PHASE 13 — Co-pilot integration tools and requests

**Goal.** "Put my LeetCode stats under my projects" works end to end from chat — rule 5 complete.

**Depends on.** Phases 7 and 11.

### What you build
- **Tools:** `search_catalogue`, `install_integration(id, props, slot)`, `move_integration(id, slot)`,
  `uninstall_integration(id)` — each creates the same operation the UI does
- **Secret-backed installs:** the co-pilot cannot receive secrets. It asks the user to complete the
  credential form, which appears inline in the chat as an action
- **Recommendations:** suggest integrations based on role and the portfolio's content
- **Integration requests:** from an empty marketplace search; duplicates count as votes; requesters are
  notified when an integration ships

### Definition of done
- [ ] Installing, moving and removing an integration all work from chat
- [ ] A secret-backed install hands off to the credential form and never exposes the key to the model
- [ ] A request for an existing request increments its vote count

**Duration: 3–4 days**

---

# PART 6 — PRODUCTISATION

## PHASE 14 — Plans, limits and super admin

**Goal.** One free portfolio, metered co-pilot and sandbox usage, a paid tier, and an operator console
that makes the platform runnable without SQL.

**Depends on.** Phases 2, 3, 7, 11.

### What you build
- **Plans and subscriptions;** the payment webhook is the only writer of subscription state
- **Enforcement in the backend:**
  - portfolio count — inside the provisioning lock
  - co-pilot messages per day — in the co-pilot service
  - sandbox minutes per day — in the lifecycle manager
  - installed integrations — inside the install operation
- **Super admin console**
  - catalogue management (deactivation never breaks installed copies)
  - **operations explorer**, filterable by type and outcome; **rejected codemods flagged as bugs**
  - **sandbox fleet:** running, paused, unhealthy, cost per day; force pause or destroy
  - **fleet updates:** bump `@plinth-pages/core`, or run a migration codemod, on a canary group before everyone —
    each as an ordinary operation through the safety net
  - users, portfolios, take offline
  - deployment failures across the fleet

### Definition of done
- [ ] Every limit holds against direct API calls
- [ ] Upgrading lifts limits immediately
- [ ] A fleet update runs on a canary group, and a repository where it fails is left untouched
- [ ] An operator can find and diagnose a failed install without database access

**Duration: 4–5 days**

---

## PHASE 15 — Landing page and production launch

**Goal.** Live on production infrastructure, with cost alarms, a real smoke test and an honest landing page.

**Depends on.** Phase 8 (Path B) or Phase 14 (Path A).

### What you build
- **Landing page:** a real published portfolio built with Plinth, the promise, the integration catalogue,
  pricing, privacy policy and terms — which must describe repository hosting and credential handling accurately
- **Production infrastructure**
  - backend `api` and `worker` as separate container services
  - production Postgres and Redis
  - admin on Vercel
  - production GitHub App, Vercel team token, E2B key; wildcard DNS for `*.plinth.dev`
- **Observability:** error tracking, logs, uptime checks, and **cost alarms** on sandbox minutes and
  tokens per day
- **Security review**
  - no installation tokens in git remotes or logs
  - co-pilot deny lists hold against path tricks
  - codemod prop escaping
  - no secret in any `NEXT_PUBLIC_` variable or client bundle
  - the development edit endpoint is removed
- **Scripted smoke test:** sign up → provision → edit by chat → (Path A) install an integration → publish →
  open the live URL signed out → check on a real phone

### Definition of done
- [ ] The smoke test passes on production
- [ ] Cost alarms fire when their thresholds are crossed in a test
- [ ] The security review checklist is complete
- [ ] You have published your own portfolio with Plinth and would share the link

**Duration: 4–5 days**

---

# APPENDIX A — Dependency graph

```
0 Platform scaffold
│
1 @plinth-pages/core + template ──────────────────────────────┐
│                                                        │
2 Repo provisioning                                      │
│                                                        │
3 E2B driver + lifecycle                                 │
│                                                        │
4 Web IDE shell                                          │
│                                                        │
5 SAFETY NET ◀───────────────────────────────────────────┤
│                                                        │
├── 6 Publish                                            │
├── 7 Co-pilot core                                      │
│     │                                                  │
│     8 Onboarding ─────────▶ 15 Launch  (Path B)        │
│                                                        │
9 CODEMOD ENGINE ◀───────────────────────────────────────┘
│
10 Packages + catalogue
│
11 Install / uninstall / move
│
├── 12 Credentials
└── 13 Co-pilot integration tools
      │
      14 Plans + super admin ──▶ 15 Launch  (Path A)
```

---

# APPENDIX B — Where the time goes if you need to cut

In order of least damage:

| Cut | Saves | Cost to the product |
|---|---|---|
| Ship two integrations instead of four | ~2 days | Smaller catalogue at launch |
| Operator console → database access | ~3 days | Slower incident handling |
| Plans and billing → everything free during the demo | ~2 days | No revenue yet |
| Render health check (Phase 5 step 9) | ~1 day | A change that compiles but crashes can reach the preview until undone |
| Code tab → diff links on GitHub | ~2 days | Weaker "real code" moment in the IDE |

**Never cut:** the staging worktree, `plinth check`, the type-check gate, the operation lock, flushing
pushes before sandbox teardown, codemod prop escaping, or credential encryption. Each protects either the
user's work or the user's secrets.

---

# APPENDIX C — Cost model

| Item | What drives it | Main control |
|---|---|---|
| E2B | Sandbox minutes | Pause on idle, destroy on inactivity, pause after publish, daily limits |
| LLM | Co-pilot turns and context size | Daily limits, targeted edits, bounded retries |
| Vercel | Projects and production builds | Project created at first publish; no `draft` builds |
| GitHub | Private repositories | Free at this scale |
| Backend hosting | Two container services, Postgres, Redis | Small instances until load demands otherwise |

The ₹5,000/month target from earlier planning is **unlikely to hold with E2B at any real usage**. Gates G1
and G3 exist to put real numbers on this before the phases that commit to it. The driver interface in
Phase 3 keeps a self-hosted sandbox driver available as a fallback without changing any phase above it.

---

*End of Development Phases*
