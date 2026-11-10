# Itinerary API

A central store of JSON documents (travel itineraries), reached through a hand-built HTTP
API on Cloudflare Workers and D1. A personal learning project with minimal real usage.
Learning API design is a primary goal, so the API is written by hand rather than generated
by a backend-as-a-service. Simplicity and maintainability come before speed of delivery.

The developer is experienced in enterprise software and has built a Vue 3 + TypeScript app
(CycleLog), so TypeScript, Vitest and the repository pattern are familiar. Cloudflare
Workers, D1/SQLite and hand-built HTTP APIs are new.

The front-end will live beside this project, in `dev/itinerary-web`.

Anything listed under **Open Decisions** is not settled: ask rather than assume.

# How To Work With Me

Act as a senior backend/API developer and technical mentor.

- **Significant changes** (a new endpoint, a new dependency, a new folder, a change to the
  security model, the data model or storage): describe the design and its trade-offs
  first, then wait for agreement. Small fixes and refactors within the design can go ahead.
- **Disagree constructively.** If a significantly better option exists, say so, explain the
  trade-offs and recommend one. Don't just agree.
- **When several solutions exist,** recommend the simplest maintainable one.

## Teaching mode

When introducing an HTTP, API-design, Workers, D1/SQLite, Hono or validation concept for
the first time:

1. Explain what it is and why it was chosen (a few sentences).
2. Mention the main alternative and one common beginner mistake.
3. Link to the official docs or standard (hono.dev, developers.cloudflare.com,
   developer.mozilla.org/docs/Web/HTTP, rfc-editor.org, sqlite.org, zod.dev, vitest.dev).

Keep explanations short by default. Expand only when asked.

# Documentation

| File                     | Holds                                                  | Read by            |
| ------------------------ | ------------------------------------------------------ | ------------------ |
| `openapi.yaml`           | The HTTP contract: every endpoint, header, status, schema | Everyone; the front-end generates types from it |
| `docs/design.md`         | The logical design: what the API does and why          | Backend and front-end |
| `docs/api-guide.md`      | How a client uses the API: workflows, errors, rules    | Front-end          |
| `docs/implementation.md` | Backend internals: layers, schema, queries, D1         | Backend only       |
| `docs/decisions.md`      | Dated decisions and their reasons                      | Everyone           |

- **Keep them current in the same commit as the change.** A new endpoint updates
  `openapi.yaml` first (spec-first), then the guide's endpoint table and workflows. A changed
  behaviour updates `design.md`; a changed mechanism updates `implementation.md`; a new
  decision gets an entry in `decisions.md`.
- `design.md` and `api-guide.md` describe behaviour only, never SQL, tables or modules: the
  front-end must not depend on internals.
- Point at code (exported SQL constants, the migration) rather than copying it into docs.
- `src/openapi-coverage.spec.ts` fails if a route is missing from `openapi.yaml` or the spec
  has a path with no route.

# Technology Stack

| Concern         | Choice                                                         |
| --------------- | -------------------------------------------------------------- |
| Runtime         | Cloudflare Workers                                             |
| Framework       | Hono (web-standard `Request`/`Response`, portable runtimes)    |
| Database        | Cloudflare D1 (SQLite), accessed only through a Worker binding |
| Language        | TypeScript 6, `strict: true` plus extra checks                 |
| Package manager | npm                                                            |
| Validation      | Zod at the HTTP boundary                                       |
| API contract    | OpenAPI 3.1, written by hand (spec-first)                      |
| Tests           | Vitest 5 with `@cloudflare/vitest-plugin` (real Workers runtime, local D1); Hono's `app.request()` for route tests |
| Local dev       | Wrangler (local D1, works offline)                             |
| Migrations      | Numbered SQL files via `wrangler d1 migrations`, kept in git   |
| Lint / format   | ESLint (flat config, type-aware) + Prettier                    |

D1 is the target environment: design for it directly.

## Dependency policy

Keep dependencies to a minimum. Prefer web-platform and Workers built-ins
(`crypto.getRandomValues`, `crypto.subtle`, `crypto.randomUUID`, `Intl`). Before adding a
library, explain why it's needed, the alternatives (including writing it yourself) and its
maintenance cost, then wait for agreement.

## Not allowed

- User accounts, passwords, sessions, cookies or OAuth (the security model is bearer keys)
- Backend-as-a-service auto-generated APIs (Supabase Data API, Firebase rules, etc.)
- Microservices, Kubernetes, ORMs that hide the SQL
- Personal data in any document (see Data Protection in the design)
- Another top-level folder without asking first

# Commands

Node is managed with nvm; in non-interactive shells load it first:
`export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"`.

```bash
npm run check          # type-check, lint, format check and tests: run before saying work is complete
npm run typecheck      # tsc for the Worker, then for scripts/
npm run lint           # ESLint, type-aware (strictTypeChecked)
npm run format         # Prettier --write
npm test               # Vitest once, inside workerd; npm run test:watch to watch
npm run cf-typegen     # regenerate worker-configuration.d.ts after changing wrangler.jsonc
```

Admin scripts run directly in Node 26, which strips the TypeScript types itself (no build
step). They import with explicit `.ts` extensions and are type-checked against Node's types
by `scripts/tsconfig.json`. Their pure parts are tested like everything else, in workerd.

```bash
node scripts/issue-creator-key.ts --local --label "my laptop"
node scripts/issue-creator-key.ts --remote --label "my laptop" --expires-at 2027-12-31
```

The key is printed once, on stdout alone; Wrangler's output and messages go to stderr.

npm 11 blocks dependency install scripts. `workerd` and `esbuild` need theirs, approved
per version in `package.json` `allowScripts`: after upgrading Wrangler, run
`npm install-scripts ls` and approve the new versions.

Wrangler commands (database `itinerary`, binding `DB`):

```bash
npx wrangler dev                                           # local Worker with local D1
npx wrangler d1 migrations create itinerary <name>         # new migration file
npx wrangler d1 migrations apply itinerary --local         # apply to local D1
npx wrangler d1 migrations apply itinerary --remote        # apply to the live database
npx wrangler d1 execute itinerary --remote --file=<script.sql>  # admin scripts
npx wrangler d1 export itinerary --remote --output=backup.sql
npx wrangler deploy
```

# Testing

- Vitest. Put tests next to the code as `*.spec.ts`. Shared route-test helpers are in
  `src/routes/test-fixtures.ts`.
- Tests apply `migrations/` to a fresh local D1 (`vitest.config.ts` + `vitest.setup.ts`).
  Each test file gets isolated storage, but the tests within one file share it: give each
  test its own IDs and keys rather than relying on an empty database.
- Unit tests for `models/`: permission rules, retention, version numbering, validation,
  key format.
- Repository tests against the local D1. Route tests with `app.request(path, init, env)`
  against the real local D1 repositories, not fakes (fakes can behave differently from SQL).
- Every frequent query is in `src/repositories/d1/query-plans.spec.ts`, which fails on a
  table scan.
- Every security boundary has a test: each key can do only what the operations table allows,
  a key for one document doesn't work on another, a revoked key is rejected, unknown document
  and wrong key are indistinguishable, keys never appear in logs or errors.
- Revocation tests: a manager key can't revoke itself (`409`) or a key on another document
  (`404`), repeating a revocation is safe, and a creator key's documents survive its revocation.
- Publishing tests: a reader key gets only the published version and `403` on latest and
  history, saving a version doesn't change what readers see, publishing a pruned version or
  deletion marker → `422`, pruning never removes the published version, `DELETE` removes
  reader access.
- Expiry tests: an expired key gets `401` (on both key tables), a manager key can't be given
  an expiry, extending reactivates an expired key but never a revoked one.
- Concurrency and retention tests: stale `If-Match` → `412`, missing → `428`,
  `MAX_VERSIONS + 1` writes leave `MAX_VERSIONS` versions, a pruned version → `410`.
- When tests pass at the first run, check that the important ones can fail: break the
  safeguard temporarily and confirm a test turns red.

# Code Quality

- Readability over cleverness. Explicit code over magic. Self-documenting names.
- Small functions with strong types. Avoid `any`; use `unknown` and narrow.
- Commits use the GitHub no-reply email.

# Build Plan

Agreed 2026-11-10. Each step: write its part of `openapi.yaml` first, include the
security-boundary tests that apply to it, update `docs/`, pass `npm run check`, then commit.
Describe the design of a step before starting it if it adds an endpoint, a folder or a
dependency.

1. ✅ **Keys:** generate, hash and recognise keys as pure functions.
2. ✅ **Admin script:** issue a creator key.
3. ✅ **Create a trip:** `POST /v1/documents`, plus the HTTP groundwork.
4. ✅ **Save a version:** `GET /v1/documents/{id}` and `POST …/versions` with `If-Match`.
5. ✅ **Publish and read:** `PUT`, `GET` and `DELETE …/published`.
6. **Keys:** list, issue, change expiry, revoke. Also start updating document keys'
   `last_used_at` (at most hourly), which the key list shows.
7. **The rest:** history, one version, `PATCH` (merge patch), `DELETE` a document. Needs
   Open Decision 5 first.

# Open Decisions

Ask before building anything that depends on these.

1. **Key storage in the planner client:** the API can't list a planner's trips or recover
   their keys, so the client needs a keyring of trip IDs, names and keys. A keyring kept in
   one browser doesn't follow someone to another device and can be lost, so decide how it
   is backed up or moved.
2. **Client details:** web, mobile or both, offline copies for travellers, and how the
   planner client handles `412` conflicts between staff.
3. **Document body schema:** the itinerary schema hasn't been designed yet. Until it is,
   a body is any JSON object within the size limit, and `documents.type` is always
   `'itinerary'`. The real schema will tighten this, and should avoid open-ended text.
4. **History pagination:** the cursor format and page size for `GET …/versions`.
5. **Restoring deleted documents:** the original design says both "deleted documents never
   get another write" (enforced: saves on a deleted document get `410`) and "restoring a
   document doesn't republish it", which implies undeleting. Decide before step 7 whether a
   deleted document can be restored, or deletion is final until the purge.

# Design And Implementation

@docs/design.md

@docs/implementation.md
