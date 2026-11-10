# Itinerary API: Implementation

Backend internals: how the design in [design.md](design.md) is built. Not for the
front-end, which should depend only on the contract (`openapi.yaml`) and the behaviour in
design.md and [api-guide.md](api-guide.md), so the backend can change without breaking it.

The code is the source of truth. This file explains the mechanisms and points to where they
live, rather than copying SQL that would then drift.

## Layers

```
src/
  index.ts       The Worker: createApp() with the D1 repositories
  app.ts         createApp(getRepositories): CORS, repositories per request, routes, errors
  app-env.ts     Hono's typing for bindings and per-request variables
  routes/        HTTP handlers: parse, validate, authenticate, call the domain, map to responses
  models/        Domain types, validation schemas, pure rules (permissions, versions, expiry, limits)
  repositories/  Interfaces (types.ts) and the D1 implementation (d1/); the only code with SQL
  auth/          Key generation, hashing, bearer parsing, key lookups
  utils/         Generic helpers with no domain knowledge (Problem Details, entity tags, body reading)
migrations/      D1 SQL migrations: the schema's source of truth
scripts/         Admin tasks run by hand in Node (creator keys; later key recovery, purging)
docs/            This file and the other design documents
```

- Routes never run SQL. Repositories never know about HTTP.
- Routes depend on a repository **interface**, never on the D1 implementation directly.
  `createApp` receives a factory that builds the repositories from each request's `env`.
- The API's JSON shape is separate from the stored shape. Repositories map between them,
  so a storage change never silently changes the API contract.
- Business rules (permissions, version numbering, expiry, limits) are pure functions or
  constants in `models/`, so they're easy to test.
- No module-level mutable state (Workers instances are short-lived and not shared). The app
  object is built once and never changes.

## Keys (`src/auth/`)

- `keys.ts`: `generateKey` (prefix + 32 bytes from `crypto.getRandomValues`, base64url via
  `Uint8Array.prototype.toBase64`), `hashKey` (SHA-256 via `crypto.subtle.digest`, a 32-byte
  `Uint8Array` bound as a BLOB) and `recogniseKey` (the kind from the exact shape, or `null`).
- SHA-256, not bcrypt/Argon2: a key has 256 bits of entropy, so a slow hash would only add
  CPU time. The API hashes before querying, so the database never sees a plaintext key.
- `bearer.ts`: reads `Authorization: Bearer <key>` (scheme case-insensitive) and builds the
  single `401` (`WWW-Authenticate: Bearer`, `no-store`, no detail).
- `creator-key.ts`: middleware for `POST /v1/documents`.
- `document-key.ts`: `lookUpWithDocumentKey` reads a document key, refuses an ID that isn't a
  UUID without a query, and runs a repository lookup that authenticates the key; `null` = `401`.

## Storage conventions (SQLite)

- IDs: UUID text (lower case, from `crypto.randomUUID()`). Booleans: integer 0/1.
- Timestamps: ISO-8601 UTC text, always from `toISOString()`, so comparing them as strings
  (as the expiry checks do) gives the right order. Expiry dates are stored as the first
  instant of the next day (`src/models/expiry.ts`).
- JSON bodies: text with `check (json_valid(body))`, stored re-serialised from the parsed
  JSON (whitespace and duplicate keys normalised), and sent back exactly as stored.
- `permission`: text with a check constraint (adding a value is a small migration).
- No JSON indexes until a real query needs one.

## Schema

The schema is [`migrations/0001_initial_schema.sql`](../migrations/0001_initial_schema.sql).
Points worth knowing:

- Two key tables, `creator_keys` and `document_keys`: their scopes differ.
- `documents` is identity only and never changes; `created_by` points at the creator key.
- `document_keys` has a check constraint that a manager key has no `expires_at`.
- `document_versions` has primary key `(document_id, version)`, a check that a deletion
  marker has a null body and other versions don't, and a trigger that aborts any `update`.
  Deletes are allowed only for pruning and purging; D1 has no roles, so this is enforced by
  the trigger plus a repository with no update method.
- Version 1's `created_by` is null (that column points at `document_keys`; the creator is on
  `documents.created_by`).
- `document_publications` has at most one row per document, with a foreign key to the
  published version, so that version can't be deleted.

## Indexing

- D1 bills for rows scanned, not rows returned, so every frequent query must use an index.
  `src/repositories/d1/query-plans.spec.ts` runs `EXPLAIN QUERY PLAN` on each frequent
  query and fails on a table `SCAN`. Export every frequent query's SQL as a constant and
  add it there.
- Primary keys and `unique` columns are indexed automatically. Foreign keys are not.
- Each index adds a written row whenever a write touches the indexed column, and writes are
  the tighter daily limit. Only add an index for a query that runs often.
- `document_versions.created_by` is deliberately not indexed: that would charge every save
  to speed up a rare leak review.
- Every repository call logs `meta.rows_read` and `meta.rows_written`
  (`repositories/d1/query-cost.ts`).
- Run `PRAGMA optimize` after a migration that creates an index.

## Queries (`src/repositories/d1/`)

- **Key check and fetch in one query.** Every document read starts from the key's unique
  hash, filters out revoked and expired keys and keys on other documents, then fetches what
  it needs through the primary key, so it reads a few rows however long the history is.
  No row → `401`.
  - `LATEST_WITH_BODY_SQL` / `LATEST_HEAD_SQL` (`documents.ts`): the latest version, with or
    without its body (writes only need the number).
  - `FIND_PUBLISHED_SQL` (`publications.ts`): left joins, so a valid key with nothing
    published still returns a row (→ `404`, not `401`).
  - `FIND_ACTIVE_CREATOR_KEY_SQL` (`creator-keys.ts`): also counts the key's documents for
    the cap, through `documents_created_by`.
- **Atomicity.** D1 has no interactive transactions: atomicity comes from `batch()`, which
  runs its statements as one transaction and rolls back if any fails. Write each statement
  so it is safe whatever the others do.
- **Creating** (`documents.create`): one batch inserts the document, version 1 and the three
  key rows, and sets the creator key's `last_used_at`.
- **Saving** (`documents.appendVersion`): one batch of `APPEND_VERSION_SQL`, which inserts
  the new version only if the base version is still the latest (`changes = 0` → `412`), and
  `PRUNE_VERSIONS_SQL`, which keeps the newest `MAX_VERSIONS` plus the published version.
  The route's earlier `412` check is a shortcut; this conditional insert is what stops a
  race. The new number comes from `nextVersion` in `models/versions.ts`, not from the SQL.
  Pruning lives here, not in a trigger (hidden behaviour) or a scheduled job (growth between
  runs).
- **Publishing** (`publications.publish`): one upsert, `PUBLISH_SQL`, that only publishes an
  existing non-deleted version of a document whose latest version isn't a deletion marker,
  so a publish racing a delete can't make a deleted document readable (`changes = 0` → `422`).
- **Revoking** (build step 6, planned):

  ```sql
  update document_keys
  set revoked_at = coalesce(revoked_at, ?1)
  where id = ?2 and document_id = ?3;
  ```

  `coalesce` makes a repeat safe and keeps the original time; zero rows → `404`;
  `document_id = ?3` stops a manager key revoking keys on another document.
- **Key `last_used_at`**: set on every create for creator keys; for document keys, updated
  at most hourly (build step 6), not on every read.
- Revocation is immediate, so key lookups are never cached.

## Requests (`src/routes/`, `src/utils/`)

- Order of checks on a write: key (`401`/`403`), preconditions (`428`/`400`/`410`/`412`),
  then the body. Preconditions come before the body is read (RFC 9110 §13.2.1), which also
  saves the CPU of parsing a body that would be refused.
- `utils/request-body.ts` counts bytes while reading (Hono's `bodyLimit` trusts
  `Content-Length`) and decodes strict UTF-8. `routes/json-body.ts` adds JSON parsing and a
  Zod schema: `415`, `413`, `400`, `422` in that order.
- `routes/problems.ts` gives each error status one wording everywhere.
- `routes/version-response.ts` sends a stored version (`200` or `304`) the same way for the
  latest and the published version.
- `app.onError` logs only the error's name and message, never the request, so a key can't
  reach the logs that way, and answers a generic `500`.

## D1 limits (free plan)

Checked 2026-11-08; verify against developers.cloudflare.com before relying on them.

| Limit                                  | Free plan                             |
| -------------------------------------- | ------------------------------------- |
| Rows read / written                    | 5 million / 100,000 per day           |
| When exceeded                          | Queries fail until 00:00 UTC          |
| Database size                          | 500 MB (5 GB per account)             |
| Row / string / BLOB size               | 2 MB (keep the document limit well below) |
| SQL statement length                   | 100 KB (bound values are passed separately) |
| Bound parameters per query             | 100                                   |
| Queries per Worker invocation          | 50 (a `batch()` counts as one)        |
| Time Travel (point-in-time restore)    | 7 days (30 on paid)                   |
| Workers CPU time per request           | 10 ms (waiting on D1 doesn't count)   |

Each D1 database processes one query at a time; fine at this usage. At 200 KB, parsing and
validating a body should stay well inside 10 ms of CPU, but measure it.

## Later

- A scheduled job (Cron Trigger) purging documents whose latest version is a deletion marker
  older than a grace period (30 days suggested). Build when deleted data takes real space.
- Rate limiting with Cloudflare's own rate limiting, keyed on the document or key.
