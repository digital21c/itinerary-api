# Decision Log

Settled decisions, newest first, each with its reason. The design documents state the
result; this log keeps the "why" and the alternatives that were turned down. Undecided
questions are under **Open Decisions** in [`CLAUDE.md`](../CLAUDE.md). Add an entry whenever
a decision is made, in the same commit as the change it causes.

## 2026-11-11

**`If-Match` accepts a weak tag, `W/"3"`, as version 3** (issue #1). Cloudflare's edge
weakens the `ETag` whenever it compresses a response, and browsers always ask for
compression, so a browser that echoed its `ETag` got `400` on every save. *Why:* the tag
names a version whose content never changes, so the weak and strong forms identify the
same thing, and the lost-update check is unchanged. This departs from RFC 9110 §13.1.1
(strong comparison for `If-Match`), on purpose. *Rejected:* `Cache-Control: no-transform`
(loses compression on bodies up to 200 KB, for travellers on poor connections); keeping
tags strong at the edge (a zone setting that `workers.dev` doesn't offer); compressing in
the Worker (more code and CPU); making every client strip `W/` (pushes an edge quirk into
each client, and the obvious echo would still fail). The contract now allows `W/` on
`ETag` too.

**Only managers issue keys, reader keys included.** The front-end's design had editors
issuing reader keys; it now follows the API. *Why:* one role controls who has access.

**`GET /v1/creator-key` checks a creator key with no side effects** (`204` or `401`). *Why:*
the front-end verifies key links before saving them, and the only other way to test a
creator key was to create a trip. Document keys need no such endpoint: `GET …/published`
already answers `200`/`404` for any valid key.

**The API provides "updated at" as `Last-Modified`** on every version response (`304`
included): the save time for the latest or a numbered version, the publication time for the
published one. Republishing the same version keeps the original time. *Why:* the front-end
shows "altered 21 days ago"; the body is the document itself (no envelope), so the time
belongs in a header, and `Last-Modified` is the standard one. It is CORS-safelisted, so no
exposure is needed. *Alternative turned down:* the client writing `updatedAt` into the
content, which every client would have to get right.

**The creator acts through the manager key returned on create.** A creator key still can't
read or edit; the front-end stores the returned manager key.

**Front-end demo keys live in a git-ignored local file,** never in the repository and never
printed in a shared transcript.

**First deployment** to `https://itinerary-api.info-cce.workers.dev` (Workers Free, the
`workers.dev` subdomain; no custom domain yet). The live database received migration 0001,
then `PRAGMA optimize`. Verified with a temporary creator key (labelled "Deploy smoke test
2026-11-11", revoked afterwards) and one test trip, deleted afterwards and still present
until a purge.

## 2026-11-10

**Restoring is a save over the deletion marker**, not a new endpoint: `POST …/versions` with
`If-Match` naming the marker. *Why:* it is what the original design meant ("posting an old
version's body as a new version"), and the conditional insert already handles races.
*Alternative turned down for now:* `POST …/restore { "version": n }`, which would copy the
body on the server; worth adding only if restoring turns out to be common.

**Deleting a document requires `If-Match`.** *Why:* it is a write to content; no one should
delete a version they haven't seen. Its `204` carries the deletion marker's `ETag`, which
restoring needs.

**The history isn't paginated** (resolving the old open decision on its cursor). *Why:*
retention caps it at 11 entries. The rule "collections use cursor pagination" stays for any
collection that can grow; a cursor can be added to the history later without breaking
clients.

**One version: a deletion marker and a pruned version are `410`, a number above the latest
is `404`.** *Why:* `410` says "it existed and is gone"; `404` says "there's no such thing".

**`PATCH` on a document answers like a save** (`201`, `Location`, `ETag`), accepts
`application/merge-patch+json` or `application/json`, must be a JSON object, and a result
over the size limit is `422`. *Why:* clients handle both writes the same way; a non-object
patch would replace the whole document, which is what a save is for.

**JSON Merge Patch is written by hand** (about 20 lines), defining members rather than
assigning them. *Why:* no dependency needed; and assigning a member named `__proto__`
would change the object's prototype instead of storing the data.

**A deleted document can be restored** by an editor or manager until it is purged, instead
of deletion being final. *Why:* a mistaken delete shouldn't need the operator. A restored
document stays unpublished. This replaces the original "deleted documents never get another
write"; the open question came from the original design saying both.

**Every key-management write checks, inside the statement, that the requesting key is still
active.** *Why:* the ban on self-revocation doesn't stop two managers revoking each other at
the same moment, which would leave a trip with no working manager key. A check in an earlier
query can't protect that; a condition in the write can, because D1 runs statements one at a
time. The second of the two gets `401`.

**Key labels name a role and a device, not a person,** and are required when issuing a key.
*Why:* a name would be personal data. The API can't enforce it, so the guide and the planner
client tell staff. *Alternative turned down:* accepting staff names as minimal staff data.

**A trip's three initial keys are labelled "Initial manager/editor/reader key".** *Why:* the
key list is readable from the start.

**The key cap counts unrevoked keys (expired ones included), and is exact.** *Why:* revoked
keys can't come back, so counting them would eventually block a trip whose keys were
replaced often; expired keys can be reactivated, so they still count. The count and the
insert are one statement.

**The key list includes revoked and expired keys, has a `status` and `isCurrentKey`, and is
not paginated.** *Why:* it doubles as the record of who had access; at most 20 keys are
active, and revoked ones accumulate slowly. A filter is the fix if it ever grows long.

**`PATCH …/keys/{keyId}` takes a JSON Merge Patch** (`application/merge-patch+json`, or plain
`application/json`): a date sets or extends the expiry, `null` removes it. *Why:* the
standard format, the same one the document `PATCH` will use. *Alternative turned down:*
`PUT` with the whole key record, resending fields that can't change.

**Key management needs no `If-Match`.** *Why:* like publishing, each request states the
whole intended result.

**Keys can't be issued on a deleted document (`410`), but can be revoked or have their
expiry changed there.** *Why:* cutting off access is always safe.

**Key-management responses are `Cache-Control: no-store`.** *Why:* security information;
after a revocation a stale copy would mislead.

**Document keys' `last_used_at` is recorded at most hourly, inline, when a key
authenticates (even if the request is then `403`).** *Why:* one write per key per hour;
`waitUntil` isn't available in `app.request()` tests and isn't worth the complexity.

**The query-plan test allows the foreign-key check scans on `document_keys` inserts.** *Why:*
SQLite plans scans of the unindexed child columns but only runs them while violations are
pending; a test measuring `rows_read` proves they don't run. Indexing those columns would
charge every write for nothing.

**Documentation split into `docs/`.** `design.md` (logical design, shared with the
front-end), `implementation.md` (backend internals), `api-guide.md` (for client developers)
and this log. `CLAUDE.md` keeps working instructions and imports the first two. *Why:* the
front-end needs the behaviour but must not depend on internals, and one long file mixed
both. The docs point at the code's SQL constants rather than copying SQL, which drifts.

**The front-end lives beside this project, in `dev/itinerary-web`.** It generates types from
`../itinerary-api/openapi.yaml` and imports the guide and design into its `CLAUDE.md`.
*Why:* no tooling needed. A single repository for both (a monorepo) would be the next step
if CI or deployment needs both in one place.

**Unpublishing moved from build step 7 to step 5.** *Why:* one statement, and it completes
the publishing lifecycle.

**Publishing needs no `If-Match`.** *Why:* `PUT { "version": n }` states the whole intended
result, so there is nothing to overwrite; it is idempotent, and of two simultaneous
publishes the later wins, which is what each asked for. `If-Match` protects content edits.

**A publish also checks, in the same statement, that the document isn't deleted.** *Why:*
otherwise a publish racing a delete could make a deleted document readable again.

**`If-Match` must be exactly one tag, `"3"`.** `*` and lists → `400` (weak tags were
also refused until 2026-11-11, see above).
*Why:* "save over the version I edited" names one version; `*` would skip the conflict
check. Stricter than RFC 9110 allows, on purpose. `If-None-Match` stays fully standard.

**Preconditions are checked before the body is read.** *Why:* RFC 9110 §13.2.1, and it
saves parsing a body that would be refused.

**Document keys' `last_used_at` deferred to build step 6.** *Why:* updating it adds writes
to reads; it belongs with the key list that shows it.

**A test fails if a frequent query scans a table.** *Why:* D1 bills rows read; this turns
the indexing rule into something that fails automatically.

**Request and response bodies are the document itself, with no envelope.** The version
travels in `ETag` / `If-Match`. *Why:* plain HTTP: the body is the resource. *Cost:* a field
such as `type` can't be added to the body later; it would go in a header or the URL.

**CORS allows any origin, without credentials.** *Why:* CORS stops sites using a visitor's
cookies; with bearer keys and no cookies it protects nothing.

**Problem `type`s:** `about:blank` when the status says everything; a relative
`/problems/<slug>` URI for problems a client must tell apart. *Why:* RFC 9457's default,
plus room to serve an explanation page later.

**The document cap per creator key is soft.** *Why:* enforcing it exactly isn't possible in
D1 without a messier batch, and one or two over is harmless for a storage limit.

**A cap being hit is `409 Conflict`.** *Why:* `403` already means "not enough permission".

**Route tests run against the real local D1, not fakes.** *Why:* the test plugin makes it
cheap, and fakes can behave differently from SQL.

**The body size limit is counted while reading, by our own reader.** *Why:* Hono's
`bodyLimit` trusts `Content-Length` when present.

**Key expiry is a calendar date, `YYYY-MM-DD`, valid through that whole day (UTC),** in the
API and the admin scripts. Stored as the first instant of the next day. *Why:* matches what
people expect from "expires 31 December", and a trip's own time zone isn't known.

**Build plan** (see `CLAUDE.md`): keys, creator-key script, create, save, publish, key
management, the rest. Each step writes its part of `openapi.yaml` first, includes its
security tests, passes `npm run check` and is committed.

**Document size limit: 200 KB** (200,000 bytes). *Why:* 500 KB was considered, but with 10
versions a document could reach 5 MB, so one creator key's cap could fill the whole free
database, and parsing would approach the 10 ms CPU limit.

**Retention and caps:** 10 versions per document, 100 documents per creator key, 20 keys per
document, no minimum age before pruning. All configuration, in `src/models/limits.ts`.

**Interim body rule:** until the itinerary schema is designed, a body is any JSON object,
and `documents.type` is always `'itinerary'`.

**An editor or manager reading a deleted document gets `410 Gone`.** Readers get `404`,
because deletion removes the publication. *Why:* they hold a valid key, so saying it
existed reveals nothing new.

**Tooling:** npm; `@cloudflare/vitest-plugin` (the renamed `vitest-pool-workers`, which is
deprecated) with Vitest 5; ESLint (type-aware) and Prettier; Zod at the HTTP boundary;
OpenAPI written by hand, spec-first. TypeScript 6, because typescript-eslint doesn't support
7 yet. Admin scripts run directly in Node 26 (type stripping), type-checked against
`@types/node` in their own `tsconfig`.

## 2026-11-08 and 2026-11-09

The initial design, now described in [design.md](design.md) and
[implementation.md](implementation.md):

- **Capability-based security with bearer keys**, no users. Four key kinds; document keys
  form a ladder; creator keys can only create. *Rejected:* accounts, sessions, OAuth.
- **Keys are hashed with SHA-256**, shown once. *Rejected:* bcrypt/Argon2, built for
  low-entropy passwords.
- **Immutable versioned snapshots**, full copies, "current" as a query. *Rejected:* diffs,
  event sourcing, a pointer row.
- **Explicit publishing** of one reviewed version. Reader keys see only that.
- **Manager keys never expire, and can't revoke themselves**, so a document always keeps a
  working manager key.
- **Cloudflare Workers Free + D1**: hard limits fail instead of billing, no idle pausing,
  free point-in-time restore. *Accepted risk:* the daily write limit can take the service
  down until midnight UTC. No rate limiting until it proves necessary.
- **Hono**, web-standard and portable; repositories behind interfaces; no ORM.
- **No personal data in documents.**
- *Rejected for now:* end-to-end encryption with the reader key.
