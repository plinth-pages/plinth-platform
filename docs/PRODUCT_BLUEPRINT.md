# PRODUCT BLUEPRINT — Plinth

> **Version:** 2.0 — written from scratch. Supersedes every earlier version of this document.
> **Architecture:** Sandbox Web IDE + AST Codemods (inspired by v0)
> **Companion:** `DEVELOPMENT_PHASES.md` — the 16-phase build roadmap
> **Date:** September 2026

---

## 0. The five architecture rules

These are fixed. Every section below is written to satisfy them, and any future proposal that
contradicts one of them must change this table first.

| # | Rule | What it means for the product |
|---|---|---|
| 1 | **Every portfolio runs as a live Next.js dev server in an E2B sandbox; its code lives in a private GitHub repository generated for the user.** | The editor shows a real running application, not a mock. The code exists in Git from minute one. |
| 2 | **Preview is the sandbox. Publish pushes to GitHub, which triggers a real Vercel production deployment.** | Editing never touches the live site. Going live is a deliberate act with a real build behind it. |
| 3 | **Integrations are npm packages. Installing one runs an AST codemod that injects the component into a locked slot in the user's React code.** | "Install LeetCode Stats" produces a real dependency and a real diff in the user's repository. |
| 4 | **After any codemod, a strict TypeScript type-check runs. If it fails, the change is reverted so the preview never breaks.** | The user can install, move and remove integrations without fear. Nothing they click can break their site. |
| 5 | **The AI is a co-pilot that can trigger codemods, place components into slots, and edit Tailwind directly in the raw React files inside the sandbox.** | The user can say "put my LeetCode card under projects and make the hero darker" and watch both happen. |

### Three consequences of these rules that shape everything else

**Consequence A — changes are staged, never applied live.** Rule 4 says a failed change is
reverted. But if a change is written into the directory `next dev` is watching, hot reload shows
the broken state before the revert happens. To honour the *intent* of rule 4 — the preview never
breaks — every change is made in a **staging worktree** inside the sandbox, checked there, and
only applied to the live tree after it passes. A rejected change is discarded; the preview never
saw it.

**Consequence B — the safety net covers the AI too.** Rule 4 names codemods, but rule 5 lets the
AI write raw React. An AI edit can break the build just as easily as a codemod. Every mutation to
the workspace — codemod, AI edit, dependency change — passes through the same net.

**Consequence C — drafts are pushed continuously, to a draft branch.** Rule 2 pushes to GitHub on
Publish. If commits lived *only* inside the sandbox until then, destroying an idle sandbox would
destroy unpublished work. So every accepted change is pushed to a `draft` branch immediately, and
Publish **promotes `draft` into `main`** — the push to the production branch that triggers the
Vercel deployment. The sandbox is always disposable; the repository is always the source of truth.

---

## 1. Executive summary

Plinth is a web IDE for building a personal portfolio by conversation.

A developer signs in with GitHub, says what they do, and within about ninety seconds is looking at
a real Next.js portfolio running live in a cloud sandbox — backed by a private GitHub repository
created for them. They paste their résumé into a chat panel and the co-pilot rewrites the React
components in front of them. They open the integration marketplace, click *Install* on
LeetCode Stats, and a real npm package is added to their repo and injected into a locked slot on
their page — type-checked before it is ever shown. When they are happy, they click *Publish* and a
real Vercel production deployment goes out.

**One-line pitch:** *Describe your portfolio. Watch it get built. Install anything. Own the code.*

**Why it can win:**

1. **The output is real code in a real repository** — not a row in someone's database.
2. **Integrations are real dependencies**, injected by codemod into slots the platform guarantees
   will exist. Every integration is engineering a competitor must also do.
3. **Nothing breaks.** Every change is staged and type-checked before the preview sees it. This is
   the property that makes a code-generating product feel safe to a non-expert.

**The wedge:** developers first — the audience with the most scattered online identity and the one
that most values owning a repository. The architecture is profession-agnostic; researchers,
designers and freelancers follow with their own integrations.

---

## 2. The problem

**Core problem:** *"My work is spread across GitHub, LeetCode, npm, papers and side projects, and I
have no single, current, good-looking place that shows it."*

| Existing option | Why it fails |
|---|---|
| Hand-coded portfolio | Takes days, goes stale, nobody maintains it |
| Carrd / Linktree / Bento | No real data, no code ownership, everyone's looks the same |
| Read.cv / Peerlist | A profile on someone else's platform, not your site |
| Framer / Webflow | Powerful, but a design tool with a learning curve and no dev integrations |
| v0 / Lovable / Bolt | Generate code well, but start from a blank prompt every time, have no concept of a stable extension point, and "adding an integration" means asking the model to write it and hoping |

**The gap:** nobody combines *generated code you own* with *installable, guaranteed-safe
integrations* and a *portfolio-shaped starting point*.

---

## 3. Who it is for

### Primary (MVP): the active developer
Engineers, CS students, open-source contributors, competitive programmers, indie hackers. Active
on GitHub; often an outdated personal site or none. Publishes to share in job applications,
freelance pitches and social bios.

### Secondary (V1): freelancers and designers
Need a contact form, testimonials, booking and a portfolio gallery — integrations, not raw code.

### Later: researchers, creators, founders
ORCID, Google Scholar, YouTube, Product Hunt. Same engine, different integration shelf.

### Personas

**Arjun, 24 — job-seeking developer.** Great GitHub, boring LinkedIn, portfolio untouched for eight
months. Wants one link for his résumé. *Activation:* sees his GitHub repos appear on a real site
in two minutes. *Abandonment:* a 90-second wait that looks broken, or a generic result.

**Priya, 28 — open-source maintainer.** Maintains three npm packages. Wants her downloads and stars
shown properly. *Activation:* "Install npm stats" produces a real diff in her repo that she can
read. *Abandonment:* the injected code is ugly, or an install breaks her page.

**Rahul, 21 — CS student.** 500+ LeetCode problems solved. *Activation:* LeetCode card installed and
live in one click. *Abandonment:* a payment wall before anything works.

---

## 4. Positioning and differentiation

**Positioning:** *The portfolio IDE — generated code you own, with integrations that install safely.*

| | Plinth | v0 / Lovable / Bolt | Framer | Carrd / Bento | Hand-coded |
|---|---|---|---|---|---|
| Real code in your repo | ✅ | ✅ | ❌ | ❌ | ✅ |
| Live preview of the real app | ✅ E2B | ✅ | ✅ | ✅ | local only |
| Portfolio-shaped starting point | ✅ | ❌ blank prompt | templates | templates | ❌ |
| Installable integrations | ✅ npm + codemod | ❌ ask the model | limited | limited | manual |
| Guaranteed extension points | ✅ locked slots | ❌ | ❌ | ❌ | ❌ |
| Changes type-checked before shown | ✅ | partial | n/a | n/a | ❌ |
| Production deploy you own | ✅ Vercel | ✅ | hosted | hosted | manual |

**Differentiators, in order of defensibility:**

1. **Locked slots + codemod installs.** An integration always lands in a known place, in code the
   platform can reason about. General code generators cannot promise this because they have no
   stable structure to promise it against.
2. **The safety net.** Staged, validated, type-checked changes. The user experiences a product where
   nothing they do can break their site.
3. **The integration catalogue.** Each package is real work. The catalogue becomes the moat.
4. **Ownership.** A private repo and a production deployment, from minute one.

---

## 5. Product principles

These are inviolable. Most are the five architecture rules seen from the user's side.

1. **The repository is the source of truth.** A sandbox can be destroyed at any moment with no loss
   of work.
2. **Editing never changes the live site.** Only Publish does.
3. **The preview never breaks because of something the platform did.** Every workspace mutation is
   staged and checked before it is applied.
4. **Slots are guaranteed.** Every slot in the vocabulary exists exactly once, and nothing but the
   codemod engine may change what is inside one.
5. **Integrations are code, not configuration.** An installed integration is visible in the repo as
   a dependency and a diff.
6. **Secrets never enter the repository, the client bundle, or the AI's context.**
7. **The AI is a co-pilot, not an authority.** It applies changes through the same safety net as
   everything else, and it never publishes.
8. **Role never restricts capability.** A "developer" can install a designer's integrations.
9. **A failed deployment leaves the previous one live.**
10. **The published portfolio does not depend on our uptime.** It is a standalone Vercel app. The one
    documented exception is an integration that stores data with us (Visitor Counter), which must render
    gracefully when we are unreachable.

---

## 6. System concepts

The vocabulary everyone on the project must share.

| Concept | Definition |
|---|---|
| **User** | A person, authenticated with GitHub. |
| **Portfolio** | The product unit: one private GitHub repo + one sandbox + one Vercel project + the platform state around them. One free per user. |
| **Repository** | `portfolio-<slug>`, private, in the platform's GitHub organisation, generated from `plinth-template`. Has two long-lived branches. |
| **`draft` branch** | Every accepted change is committed and pushed here. What the sandbox runs. |
| **`main` branch** | The production branch. Only Publish writes to it. Vercel deploys it. |
| **Sandbox** | An E2B microVM running `next dev` against the repo. Disposable: paused when idle, destroyed after long inactivity, recreated from `draft` on demand. |
| **Live tree** | The working directory `next dev` serves. Only ever receives changes that passed the safety net. |
| **Staging worktree** | A `git worktree` inside the sandbox where every change is made and checked before it reaches the live tree. |
| **Slot** | A named, locked extension point in the React code: `<Slot name="afterProjects">…</Slot>`. The vocabulary is fixed and versioned. |
| **Integration** | An npm package (`@plinth-pages/leetcode-stats`) plus a manifest describing its slots, props, secrets and files. |
| **Codemod** | A deterministic AST transformation (ts-morph) that inserts, moves or removes an integration's import and JSX inside a slot. |
| **Safety net** | The pipeline every mutation passes: stage → format → slot validation → TypeScript type-check → apply or discard. |
| **Operation** | One queued, locked, recorded mutation: an install, an uninstall, a placement change, or a co-pilot edit batch. |
| **Co-pilot** | The AI agent. Its tools read and edit files and call the codemod engine — all through operations. |
| **Deployment** | A Vercel production build of a specific `main` commit. |
| **`plinth.json`** | A machine-owned file in the repo recording installed integrations, their versions and slot placements. The slot validator checks the code against it. |

### Relationship map

```
User
 └── Portfolio  (1 free, more on premium)
       ├── Repository  (private, platform org)  ← SOURCE OF TRUTH
       │     ├── draft  ── every accepted change ──▶ runs in the Sandbox
       │     └── main   ── Publish only          ──▶ Vercel production deployment
       ├── Sandbox (E2B)
       │     ├── live tree         ← next dev serves this
       │     └── staging worktree  ← every change is checked here first
       ├── Installed integrations  (mirrored in plinth.json)
       ├── Credentials  (encrypted; synced to sandbox env and Vercel env)
       ├── Conversation  (co-pilot history)
       └── Operations and Deployments  (audit history)
```

---

## 7. Repositories

**Three repositories are maintained by us. One is generated per portfolio.**

| Repository | Contains | Deploys to |
|---|---|---|
| **`plinth-platform`** | `backend/` — NestJS, `api` and `worker` process roles · `admin/` — Next.js (Web IDE, dashboard, marketing, super admin) · `packages/shared` — API contract types · `packages/codemod` — the AST codemod engine | backend + worker → a container host · admin → Vercel |
| **`plinth-template`** | The starting portfolio: raw React + Tailwind section components, content files, slot call sites, `plinth.json`, CI. A GitHub *template repository*. | nothing — it is only ever copied |
| **`plinth-packages`** | `@plinth-pages/core` (the `Slot` component, slot vocabulary, `plinth.json` schema) · `@plinth-pages/check` (the `plinth check` validator CLI — a devDependency, since it bundles the TypeScript compiler) · `@plinth-pages/integration-types` · one package per integration | npm |
| **`portfolio-<slug>`** × N | One user's portfolio | Vercel |

### What lives in npm, and what lives in the user's repo

Rule 5 lets the AI edit raw React and Tailwind — so the visual components **must** live in the
user's repository, where they can be edited. Only infrastructure lives in npm, where it can be
upgraded across every portfolio later.

| In the user's repo — editable, owned | In npm — upgradable across the fleet |
|---|---|
| `components/sections/*.tsx` — Hero, About, Projects… | `@plinth-pages/core` — `Slot`, slot vocabulary · `@plinth-pages/check` — `plinth check` |
| `content/*.ts` — the user's data | `@plinth-pages/<integration>` — each integration's component |
| `app/page.tsx`, `app/layout.tsx` — including slot call sites | |
| `plinth.json` — installed integrations, machine-owned | |

**Why this split matters:** a generated repo is never re-synced from the template, so anything in the
template is frozen at generation time. Putting `Slot` and the validator in `@plinth-pages/core` means a fix
to either reaches every existing portfolio through a version bump. Putting the section components
in the repo means the co-pilot can restyle them freely — which is the point of rule 5.

---

## 8. Core user journey

```
LANDING ─▶ SIGN IN WITH GITHUB ─▶ PICK A ROLE
                                      │
                                      ▼
PROVISIONING  (~60-90 s, real named steps shown)
  ├─ create portfolio record
  ├─ generate private repo from plinth-template; create draft branch
  └─ boot E2B sandbox: clone draft → install → next dev
                                      │
                                      ▼
WEB IDE opens with a populated portfolio already running
  ├─ CO-PILOT ─ "Here's my résumé" · "make the hero darker"
  ├─ PREVIEW  ─ iframe onto the sandbox's next dev
  └─ CODE     ─ file tree + diff of every change
                                      │
               ┌──────────────────────┼───────────────────────┐
               ▼                      ▼                       ▼
        CO-PILOT EDIT          INSTALL INTEGRATION      MOVE / REMOVE
               └──────────── every mutation ──────────────────┘
                                      ▼
                                 SAFETY NET
      stage in worktree → format → slot check → tsc
                    │ fail                              │ pass
                    ▼                                   ▼
      discard; preview untouched;          apply to live tree → hot reload
      explain in plain language            → commit → push draft
                                      │
                                      ▼
PUBLISH ─▶ (first time: create Vercel project, claim slug) ─▶ promote draft → main ─▶ Vercel production build ─▶ asha.plinth.dev
                                      │
                                      ▼
RETURN ─▶ sandbox resumes (or rebuilds from draft) ─▶ edit ─▶ live site unchanged until Publish
```

---

## 9. First five minutes

| Time | What happens | Design requirement |
|---|---|---|
| 0:00 | Landing page shows a real published portfolio and the promise | Proof, not screenshots |
| 0:20 | Sign in with GitHub | One sentence before the redirect: "We create a private repository for your portfolio." |
| 0:40 | "What describes you?" — one click | Pre-select Developer for GitHub sign-ins |
| 1:00 | Provisioning with **named steps**; the repo link appears the moment it exists | Never a spinner. A blank 90-second wait is the biggest drop-off risk in the product. |
| 2:00 | IDE opens. Their **real** name, avatar, bio and top repos are already on the page | Never a blank canvas |
| 2:30 | First prompt from a chip: "Paste your résumé" | Chips, not an empty text box |
| 3:00 | Content rewrites in place; the Code tab shows the diff | The diff is a feature: it proves this is real code |
| 3–5 | Install LeetCode Stats, or Publish | By minute five: published, or deep in conversation |

**Onboarding is two steps** — role, then automatic provisioning. There is no template picker and no
profile form: GitHub supplies the profile, and everything else is faster to say in chat.

---

## 10. The Web IDE

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ Plinth · asha      ● Saved to draft   [Repo ↗] [Desktop|Tablet|Mobile] [Publish ●] │
├────────────────────┬──────────────────────────────────────────────────────────┤
│ CO-PILOT           │  PREVIEW  │  CODE                                        │
│                    │ ┌──────────────────────────────────────────────────┐     │
│ conversation with  │ │ iframe → the sandbox's public preview URL        │     │
│ operation cards:   │ │ the real app, served by next dev                 │     │
│  ✓ Installed       │ │                                                  │     │
│    LeetCode Stats  │ └──────────────────────────────────────────────────┘     │
│  ↺ Not applied:    │                                                          │
│    type error      │  CODE tab: file tree · read-only viewer ·                │
│                    │  diff of each operation                                  │
│ [chips] [message]  │                                                          │
├────────────────────┤                                                          │
│ Integrations       │                                                          │
│ Slots              │                                                          │
│ Theme · Settings   │                                                          │
└────────────────────┴──────────────────────────────────────────────────────────┘
```

| Panel | MVP | Notes |
|---|---|---|
| Co-pilot chat | ✅ | Streams; every change appears as an **operation card** with status and a diff link |
| Preview | ✅ | Iframe onto the sandbox; device widths resize the iframe so real breakpoints fire |
| Code — file tree and viewer | ✅ read-only | Shows the user their code is real |
| Code — per-operation diff | ✅ | The most persuasive screen in the product |
| Code — direct editing | V1 | Same safety net as every other mutation |
| Integrations panel | ✅ | Installed list, marketplace, configure, uninstall |
| Slots panel | ✅ | Every slot, what is in it, move an integration between slots |
| Theme controls | ✅ | Presets and accent swatches — a fast path that runs an ordinary operation |

**Operation cards are the IDE's spine.** Every change is a card showing *queued → checking → applied*
or *not applied, with the reason in plain language*. The user always knows what changed, and why
something did not.

---

## 11. Preview: the E2B sandbox

| State | User sees | System does |
|---|---|---|
| Starting | "Starting your preview" with named steps | Create sandbox from the Plinth E2B template, clone `draft`, `pnpm install`, `next dev` |
| Running | The live portfolio | Hot reload on every applied change |
| Paused | "Waking your preview…" for a few seconds | Resume on the next request |
| Destroyed | Same message, slightly longer | Recreate from `draft`. Nothing lost. |
| Unhealthy | "Your preview stopped responding" + **Restart** | Restart `next dev` first; rebuild only if that fails |

**Cost control is a product behaviour, not a hidden limitation.** Sandboxes pause after idle time and
are destroyed after long inactivity. Because the repository is the source of truth, this costs the
user nothing but a short wake-up.

**The sandbox image is pre-warmed** — Node, pnpm, git, and a pnpm store already holding the template's
dependencies — so cold start is dominated by clone and `next dev`, not by package downloads.

---

## 12. Draft and Live

| | Draft | Live |
|---|---|---|
| Branch | `draft` | `main` |
| Runs on | E2B sandbox (`next dev`) | Vercel production |
| Updated by | Every accepted operation (pushed immediately) | Publish only |
| Address | The sandbox preview, inside the editor | `asha.plinth.dev` |

### Publish

```
[Publish]
  ├─ pre-flight: no operation running · draft pushed · plinth check passes · next build passes
  ├─ first publish only: claim a slug
  ├─ promote: fast-forward main to draft, push main
  ├─ Vercel builds main (production)
  │     ├─ success → live URL updated; sandbox may pause to save cost
  │     └─ failure → previous deployment STAYS live; real error shown; co-pilot can fix
  └─ a deployment is never retried automatically
```

The `draft` branch must **not** trigger Vercel builds, or every co-pilot edit becomes a deployment.
Automatic deployments are disabled for `draft` in the Vercel project configuration.

**Unpublished changes** is simply `draft` being ahead of `main`, shown as a dot on the Publish button.

**Revert to last published** is cheap and planned for V1: reset `draft` to `main`.

---

## 13. Slots

### What a slot is

A named, locked place in the page where integrations live. In the user's code:

```tsx
import { Slot } from "@plinth-pages/core";
// plinth:imports:start — managed by Plinth
import { LeetCodeStats } from "@plinth-pages/leetcode-stats";
// plinth:imports:end

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-6">
      <Hero />
      <Projects />
      <Slot name="afterProjects">
        {/* plinth:leetcode-stats:start */}
        <LeetCodeStats username="asha" />
        {/* plinth:leetcode-stats:end */}
      </Slot>
      <Contact />
    </main>
  );
}
```

### The vocabulary (frozen, versioned in `@plinth-pages/core`)

| Slot | File | Typical use |
|---|---|---|
| `head` | `app/layout.tsx` | Analytics and meta scripts |
| `bodyEnd` | `app/layout.tsx` | Chat widgets, deferred scripts |
| `providers` | `app/layout.tsx` | Context providers an integration needs |
| `heroAfter` | `app/page.tsx` | Status badges, availability banner |
| `beforeProjects` | `app/page.tsx` | Highlighted stats |
| `afterProjects` | `app/page.tsx` | Coding stats, contribution graphs |
| `sidebar` | `app/page.tsx` | Compact widgets |
| `beforeContact` | `app/page.tsx` | Testimonials, booking |
| `contact` | `app/page.tsx` | Contact forms |
| `footer` | `app/page.tsx` | Visitor counters, badges |

Adding a slot in a later `@plinth-pages/core` version is safe. **Renaming or removing a slot is a breaking
change** that requires a migration codemod across every portfolio.

### What "locked" means — precisely

| Allowed for the co-pilot (and, in V1, the user) | Only the codemod engine may do |
|---|---|
| Edit Tailwind classes and layout **around** slots | Change anything **inside** a `<Slot>` |
| Restyle any section component | Edit the `plinth:imports` region |
| Rewrite content | Add, remove or rename a `<Slot>` |
| | Move a slot call site (via the `move_slot` codemod, not free-text edits) |
| | Edit `plinth.json` |

These rules are enforced by **`plinth check`**, which parses the files and verifies that every
vocabulary slot appears exactly once, that each slot's contents match what `plinth.json` says is
installed there, and that the imports region matches the installed packages. A violation fails the
safety net and the change is discarded. The same check runs in the repository's CI.

---

## 14. Integrations

### Anatomy of an integration

```
@plinth-pages/leetcode-stats            (npm package)
  ├─ exports <LeetCodeStats username />
  └─ plinth.manifest.json
       ├─ id, name, category, version
       ├─ defaultSlot: "afterProjects"
       ├─ allowedSlots: ["beforeProjects", "afterProjects", "sidebar"]
       ├─ props:   { username: { type: "string", required: true, validate: "leetcode-user" } }
       ├─ secrets: []            (contact form: ["RESEND_API_KEY"])
       └─ files:   []            (contact form: an API route template)
```

### Install

```
User (or co-pilot) installs LeetCode Stats with username "asha"
  → API returns 202 { operationId }
  → worker acquires the portfolio's operation lock
  → staging worktree created at draft HEAD
  → pnpm add @plinth-pages/leetcode-stats@1.2.0              (in staging)
  → codemod: insert import into the plinth:imports region
             insert <LeetCodeStats username="asha" /> into <Slot name="afterProjects">
  → write manifest files and the plinth.json entry
  → format touched files
  → plinth check            (slot integrity)
  → tsc --noEmit            (strict type-check)            ← RULE 4
      ├─ pass → apply to live tree → hot reload → commit → push draft
      └─ fail → discard staging; preview untouched; show reason
  → operation: applied | reverted | failed
```

### Types of integration

| Type | User provides | Example |
|---|---|---|
| Zero-config | nothing | Visitor counter |
| Public identifier | a username, validated live | LeetCode, GitHub Stats, npm, Codeforces |
| Secret-backed | an API key, smoke-tested before saving | Contact form, analytics |
| Content | a short form | Testimonials |
| Link-only | a URL | LinkedIn, Instagram — no usable public API, and the catalogue says so honestly |

### Placement and removal

- **Move:** Slots panel or co-pilot ("move LeetCode above projects") → `move_integration` codemod → safety net.
- **Uninstall:** remove the JSX block and import, delete manifest files, `pnpm remove`, update `plinth.json` → safety net → apply.

### Launch catalogue (MVP)

1. **LeetCode Stats** — public identifier; proves the codemod path visibly.
2. **GitHub Stats** — public identifier; the developer audience's first request.
3. **Contact Form** — secret-backed; proves credentials, file templates and server routes.
4. **Visitor Counter** — zero-config; answers "how many people saw my site".

### Requests

Searching for a missing integration offers *Request it*. Duplicate requests count as votes; the queue
decides what is built next; requesters are notified when it ships.

---

## 15. The safety net

The product promise that makes a code-generating tool feel safe: **nothing you do in Plinth can
break your preview.**

```
          mutation (codemod · co-pilot edit · dependency change)
                              │
                              ▼
   ┌──────── STAGING WORKTREE at draft HEAD ─────────────┐
   │ 1. apply the change                                  │
   │ 2. format touched files                              │
   │ 3. plinth check   — slots intact, imports match      │
   │ 4. tsc --noEmit   — strict, incremental              │
   └──────────────────────────────────────────────────────┘
          │ pass                              │ fail
          ▼                                   ▼
   fast-forward the live tree          discard the worktree
   next dev hot reloads                live tree never touched
   commit + push draft                 reason → operation card
          │                            (co-pilot may retry, max 3 attempts)
          ▼
   5. render health check — the preview route responds without an error overlay
          │ fails
          ▼
   automatic revert commit, push, notify
```

| Guarantee | Enforced by |
|---|---|
| A change that does not type-check never reaches the preview | Steps 3–4 run in staging, before apply |
| Slots cannot be silently damaged | Step 3, plus the same check in CI |
| Two changes never interleave | One operation lock per portfolio; operations queue |
| A change that type-checks but crashes at render is undone | Step 5 |
| Nothing is lost | Every applied change is a commit on `draft`, pushed immediately |

**An honest limit:** type-checking proves the code compiles, not that it looks right. The co-pilot can
still make a tasteful page ugly. That is what per-operation diffs, Git history and a first-class
"undo last change" chat command are for.

**A metric that falls out of this:** a reverted **codemod** is a bug in our codemod or template —
codemods are deterministic transforms against known code. A reverted **co-pilot edit** is expected
behaviour. They are tracked separately.

---

## 16. The co-pilot

### What it can do

| Tool | Purpose | Through the safety net |
|---|---|---|
| `read_file`, `list_files`, `search` | Understand the project | — read only |
| `edit_file` | Edit React, Tailwind and content files | ✅ |
| `install_integration(id, props, slot)` | Install from the catalogue | ✅ via an install operation |
| `move_integration(id, slot)` | Place a component into a different slot | ✅ |
| `uninstall_integration(id)` | Remove one | ✅ |
| `apply_theme(preset)` | Change colours, fonts, spacing | ✅ |
| `check` | Run `plinth check` and `tsc` in staging without applying | — |
| `ask_user` | Clarify | — |

### What it cannot do

- Read or write `.env*`, `.git/` or `node_modules/`
- Edit inside a `<Slot>`, the imports region, `plinth.json`, `package.json` or the lockfile — those
  change only through integration tools
- Publish, change the slug, or touch billing
- Bypass the operation lock or the safety net

These limits are **enforced by the tools**, not requested in the prompt. A prompt instruction is a
request the model will eventually ignore; a tool that refuses is a constraint.

### How it behaves

- Batches a multi-file request into **one operation**, so a request applies entirely or not at all.
- On a failed check, reads the errors and retries within the same operation, up to three attempts.
  If it still fails, the change is discarded and it explains what it tried.
- Describes every change in one plain sentence and links the diff.
- Never acts unprompted.

---

## 17. Credentials and secrets

- Entered once, **smoke-tested before saving**, encrypted at rest (AES-256-GCM), scoped to one portfolio.
- Synced into the sandbox's `.env.local` for preview, and into the Vercel project's environment
  variables for production.
- **Never** in the repository, a `NEXT_PUBLIC_*` variable, the client bundle, a response to the admin
  UI, or the co-pilot's context.
- Integrations that need a secret ship a **server route template** (for example
  `app/api/plinth/contact/route.ts`) that the install writes into the repo; the route reads the secret
  from the environment at request time.
- Consequence: secret-backed integrations run **without calling our servers**, which keeps principle 10
  true. Integrations that store data with us are the documented exception and must degrade gracefully.
- Disconnecting deletes the credential and removes it from both environments.

---

## 18. Template evolution

| Change | How it reaches existing portfolios |
|---|---|
| Bug fix or new slot in `Slot` / `plinth check` | Publish `@plinth-pages/core` → a fleet-update operation bumps the dependency in each repo → safety net → commit to `draft` → the user publishes when ready |
| Improvement to an integration | Publish the package → offered as an update in the Integrations panel |
| New section component or design | Reaches **new** portfolios only; existing users can ask the co-pilot to adopt it |
| Renamed or removed slot | Breaking: a migration codemod across the fleet, canaried on a small group first |

Fleet updates are ordinary operations through the safety net, so an update that fails on one heavily
customised repository is discarded for that repository instead of breaking it.

---

## 19. Dashboard, plans and limits

**Dashboard:** portfolio card (status, live URL, repo link, last deploy, unpublished-changes count),
installed integrations, plan usage.

| | Free | Pro (~$8/mo) | Business (later) |
|---|---|---|---|
| Portfolios | **1** | 3 | unlimited |
| Co-pilot messages / day | 20 | 200 | priority |
| Sandbox editing time / day | limited | extended | extended |
| Integrations installed | 3 | unlimited | unlimited |
| Custom domain | — | — | ✅ |
| "Built with Plinth" badge | shown | removable | removable |
| Transfer repo to own GitHub | — | ✅ | ✅ |

**The limits that map to real cost** are portfolio count, co-pilot messages and sandbox time.
Integration count is a packaging lever, not a cost lever. **Every limit is enforced in the backend,
inside the provisioning and operation locks** — never only in the UI.

---

## 20. Super admin

| Area | Capabilities |
|---|---|
| Catalogue | Add or edit manifests; activate or deactivate (deactivation never breaks installed copies) |
| Requests | Review, update status, notify requesters |
| Users and portfolios | Search, suspend, take a portfolio offline |
| **Operations** | Failed and reverted operations with full logs; **reverted codemods flagged as bugs** |
| **Sandbox fleet** | Running, paused, unhealthy; cost per day; force pause or destroy |
| **Fleet updates** | Roll `@plinth-pages/core` or a migration codemod to a canary group, then to everyone |
| Deployments | Failed builds across the fleet |

---

## 21. Trust, privacy and security

- **Repository honesty:** repos are private and hosted in the platform organisation so we can support
  and patch them. The UI says exactly that. Transfer to the user's own account is a Pro feature.
- **Least privilege:** the GitHub App can access only the platform organisation's portfolio repos;
  sign-in requests profile scope only.
- **Sandbox preview URLs** may be reachable by anyone who has them. Drafts contain no client-side
  secrets, pages are `noindex`, and an authenticated preview proxy is planned.
- **The co-pilot never sees secrets**, and conversations are not used to train models.
- **Deletion** removes the sandbox, the Vercel project and credentials, and archives then deletes the
  repository after a grace period.
- **Content policy:** portfolios can be reported and taken offline.

---

## 22. Errors and empty states

| Situation | Message | Action |
|---|---|---|
| Change failed type-check | "That change didn't compile, so I didn't apply it. Your preview is unchanged." | Ask the co-pilot to try again |
| Codemod not applied | "Couldn't install LeetCode Stats — nothing was changed. We've been notified." | Retry |
| Render check failed | "That change broke the page when it loaded, so I undid it." | — |
| Operation queued | "Waiting for the install to finish…" | — |
| Sandbox waking | "Waking your preview…" | Automatic |
| Sandbox unhealthy | "Your preview stopped responding." | Restart |
| Deploy failed | "Your site didn't build. **Your live site is unchanged.**" + reason | Retry · Ask co-pilot to fix |
| Invalid integration input | "No LeetCode user called 'xyz'." | Re-enter |
| Credential rejected | "That API key didn't work." | Re-enter |
| Repo creation delayed | "GitHub is slow right now — still setting up." | Automatic retry |
| Plan limit | "Your free plan includes one portfolio." | Upgrade |
| Empty chat | "Paste your résumé, or tell me what to change." | Chips |
| No integrations | "Integrations pull live data from where your work lives." | Browse |
| No search results | "No integration for 'CodeChef' yet." | Request it |

**Rule:** whenever a change, build or deployment fails, say whether the preview and the live site are
affected. That is what the user is actually worried about.

---

## 23. Scope

### MVP
- GitHub sign-in, role selection, provisioning with visible progress
- A private repo per portfolio (platform org) with `draft` and `main`
- E2B sandbox preview with pause, resume, rebuild and restart
- Web IDE: co-pilot chat, preview, read-only code with per-operation diffs, slots panel
- Safety net: staging worktree, `plinth check`, strict `tsc`, render health check, operation lock
- AST codemod engine: install, move, uninstall
- Co-pilot with file-edit and integration tools
- Four integrations: LeetCode Stats, GitHub Stats, Contact Form, Visitor Counter
- Credential vault, synced to sandbox and Vercel
- Publish: promote `draft` → `main`, Vercel production deploy, previous deploy stays live
- One free portfolio; co-pilot message and sandbox-time limits
- Minimal super admin: catalogue, operations, sandbox fleet, take offline

### V1
- Direct code editing in the IDE, through the safety net
- Revert to last published; shareable draft links behind an authenticated preview proxy
- 6–10 more integrations, chosen by request volume
- Analytics, SEO controls, generated OG images
- Repository transfer; Pro plan
- Starting content for designers and researchers

### Not building
- A drag-and-drop visual builder — the co-pilot and the code are the editor
- A commerce backend — portfolios have no carts or orders
- Multi-page sites, blogs, a CMS
- Team collaboration
- A public third-party integration SDK (V2+, after our own catalogue is stable)
- Self-hosted sandboxes in MVP — E2B per rule 1 (kept possible behind the driver interface)

---

## 24. Business model and unit costs

**Freemium.** Free must be good enough to publish and share, because every published portfolio carries
the badge that drives acquisition.

### What each active portfolio costs us

| Cost | Driver | Control |
|---|---|---|
| E2B compute | Minutes a sandbox runs | Pause on idle, destroy on inactivity, pause after publish, daily sandbox-time limit |
| LLM tokens | Co-pilot turns | Daily message limit, batched operations, persisted context |
| Vercel | Projects and builds | No builds on `draft`; deployments on Publish only |
| GitHub | Private repos in an organisation | Free at our scale |

### The budget reality

The earlier target was **under ₹5,000/month**. Rule 1 puts that at risk: E2B is metered compute, and
its paid tiers — plus a Vercel plan that supports organisation-owned private repositories — may exceed
that figure on their own. **Both must be priced before the phases that depend on them** (see §27).
The sandbox layer is built behind a driver interface, so a self-hosted Docker driver remains a drop-in
fallback if E2B proves incompatible with the budget, without changing anything above the driver.

---

## 25. Metrics

**North star:** published portfolios viewed per week.

| Area | Metric | Target |
|---|---|---|
| Activation | Time to first running preview (p50) | < 90 s |
| Activation | Sign-up → first publish | 30% |
| Safety | **Codemod revert rate** | ≈ 0% — every revert is a bug |
| Safety | Co-pilot edit revert rate | tracked, trending down |
| Safety | Render-check reverts | near zero |
| Reliability | Install success rate | > 98% |
| Reliability | Deployment success rate | > 97% |
| Engagement | Integrations installed per published portfolio | ≥ 1 |
| Cost | Sandbox minutes and tokens per active portfolio | tracked weekly |
| Retention | 30-day return after first publish | 40% |

---

## 26. Risks

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| E2B cost or plan limits break the budget | High | High | Price early; pause aggressively; driver interface keeps a self-hosted fallback |
| Vercel plan cannot deploy org-owned private repos affordably | High | Medium | Verify before Phase 6; alternatives are a paid plan or API-driven deploys |
| Heavily AI-edited files make codemods ambiguous | High | Medium | Codemods anchor on `<Slot>` elements, not surrounding code; slots are locked |
| Code type-checks but breaks at render | Medium | Medium | Render health check with automatic revert |
| Hot reload shows an intermediate broken state | High | Low | Changes applied only from a passing staging worktree |
| Unpublished work lost when a sandbox is destroyed | Critical | Low | Every accepted change pushed to `draft` immediately |
| A secret leaks via the AI context or client bundle | Critical | Low | Tool-level deny lists; server routes only; no `NEXT_PUBLIC_` secrets |
| A bug ships in the template | High | Medium | Template and `@plinth-pages/core` separated; fleet updates through the safety net |
| GitHub secondary rate limits during provisioning bursts | Medium | Medium | Recovery job; throttled bulk operations |
| A draft preview URL is shared publicly | Medium | Medium | No client-side secrets; `noindex`; authenticated proxy in V1 |
| LLM cost scales with sign-ups | High | High | Per-plan limits; operation batching |
| The solo build takes longer than planned | High | High | The Path B milestone in the roadmap |

---

## 27. Open decisions and things to verify

### Verify before building the phase that depends on it

| Item | Why it matters | Before |
|---|---|---|
| E2B pricing, maximum session length, pause/resume availability and concurrency limits on the intended plan | The lifecycle design assumes pause/resume and long-lived sessions | Phase 3 |
| Whether E2B preview URLs can require a token | Draft privacy | Phase 4 |
| Vercel plan support for private repos owned by a GitHub organisation, and disabling deployments per branch | Rule 2 depends on both | Phase 6 |

### Product decisions still open

1. **Repository location long-term** — the platform organisation (current) or the user's own account.
2. **Direct code editing** — read-only in MVP (current) or editable from day one.
3. **Budget** — accept that E2B likely exceeds ₹5,000/month at any real usage, or run the self-hosted
   driver for the demo period.

---

## 28. Roadmap summary

Full detail in `DEVELOPMENT_PHASES.md`.

| Part | Phases | Outcome |
|---|---|---|
| Foundations | 0–2 | Platform scaffold, template and `@plinth-pages/core`, private repo generation |
| Sandbox and IDE | 3–4 | E2B preview running inside the Web IDE |
| Safety net and publish | 5–6 | Staged, checked changes; `draft` → `main` → Vercel |
| Co-pilot | 7–8 | AI edits through the safety net; onboarding — **Path B milestone** |
| Codemods and integrations | 9–13 | AST engine, packages, install pipeline, credentials, co-pilot integration tools |
| Productisation | 14–15 | Plans, super admin, landing page, production launch |

*End of Product Blueprint*
