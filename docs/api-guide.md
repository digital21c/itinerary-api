# Itinerary API: Client Guide

For developers of clients, starting with the front-end in `dev/itinerary-web`. It explains
how to use the API: the workflows, what to do with each response, and the rules a client
must follow. The exact contract (every endpoint, header, status and schema) is
[`openapi.yaml`](../openapi.yaml); the reasons behind the rules are in
[design.md](design.md).

## Using these documents from the front-end

The front-end lives beside this project, so it reads these files by relative path rather
than copying them.

- **Types:** generate TypeScript types from the contract, so they always match it, for
  example `npx openapi-typescript ../itinerary-api/openapi.yaml -o src/api/schema.d.ts`
  (a dev dependency, to be agreed in the front-end project). Regenerate after the contract
  changes.
- **Claude Code:** the front-end's `CLAUDE.md` can import this guide and the design, so
  they're always current:

  ```markdown
  @../itinerary-api/docs/api-guide.md
  @../itinerary-api/docs/design.md
  ```

  Claude Code asks once before following an import outside the project. Don't import
  `implementation.md`: the front-end must not depend on backend internals.
- **Reference docs:** a browsable HTML version of the contract can be generated on demand,
  e.g. `npx @redocly/cli build-docs ../itinerary-api/openapi.yaml`.

## What exists today

| Endpoint                                   | Purpose                              | Status  |
| ------------------------------------------ | ------------------------------------ | ------- |
| `POST /v1/documents`                       | Create a trip                        | Built   |
| `GET /v1/documents/{id}`                   | The latest working version           | Built   |
| `POST /v1/documents/{id}/versions`         | Save a new full version              | Built   |
| `GET /v1/documents/{id}/published`         | What travellers see                  | Built   |
| `PUT /v1/documents/{id}/published`         | Publish a version                    | Built   |
| `DELETE /v1/documents/{id}/published`      | Unpublish                            | Built   |
| `GET /v1/documents/{id}/keys`              | List the trip's keys                 | Planned (step 6) |
| `POST /v1/documents/{id}/keys`             | Issue a key                          | Planned (step 6) |
| `PATCH /v1/documents/{id}/keys/{keyId}`    | Change a key's expiry                | Planned (step 6) |
| `DELETE /v1/documents/{id}/keys/{keyId}`   | Revoke a key                         | Planned (step 6) |
| `GET /v1/documents/{id}/versions`          | History: numbers and dates, no bodies | Planned (step 7) |
| `GET /v1/documents/{id}/versions/{n}`      | One version                          | Planned (step 7) |
| `PATCH /v1/documents/{id}`                 | JSON Merge Patch on the latest version | Planned (step 7) |
| `DELETE /v1/documents/{id}`                | Delete the trip                      | Planned (step 7) |

Only built endpoints are in `openapi.yaml`.

## Keys: the rules every client follows

- Send the key only as `Authorization: Bearer <key>`. Never put a key in a query string, a
  path, a log, an analytics event or an error report.
- **A key is shown once.** `POST /v1/documents` returns the trip's manager, editor and reader
  keys in its response, and they can never be retrieved again. Store them before doing
  anything else. Where the planner client keeps them (its "keyring"), and how that is
  backed up or moved between devices, is still an open decision.
- The prefix tells you what a key is for: `ck_` creator, `mk_` manager, `ek_` editor,
  `rk_` reader. A trip's keys work only on that trip.
- A `401` never says why: missing, malformed, unknown, revoked and expired keys, and trips
  that don't exist, all look the same. Treat it as "this key doesn't work here" and ask for
  a new one. A `403` means the key works on this trip but can't do this.

## Workflow: create a trip

1. Get a creator key from the operator (they are issued by an admin script, not the API).
2. `POST /v1/documents` with the creator key and the itinerary as the JSON body (any JSON
   object for now; the itinerary schema isn't designed yet). No envelope: the body *is* the
   document.
3. The `201` gives `{ id, managerKey, editorKey, readerKey }`, `Location` and `ETag: "1"`.
   Store all three keys with the ID now.
4. The trip is unpublished, so travellers see nothing yet.

## Workflow: edit a trip (staff)

1. `GET /v1/documents/{id}` with an editor or manager key. Keep the `ETag` (e.g. `"3"`):
   it is the version you are editing.
2. Save with `POST /v1/documents/{id}/versions`, the whole new document as the body, and
   `If-Match: "3"`. The `201` gives the new version's `ETag` (`"4"`) and `Location`; use the
   new `ETag` for the next save.
3. **`412 Precondition Failed`** means someone saved after the version you edited. Nothing
   was lost or overwritten. Fetch the latest version, apply your changes to it (or show the
   user both), and save again with the new `ETag`. How the planner client presents this to
   staff is still an open decision.
4. A save that succeeded but timed out, then retried, also gets `412`: fetch the latest and
   compare before saving again.
5. `428` means `If-Match` was missing; `400` means it wasn't a single version tag like `"3"`
   (no `*`, no lists, no `W/`).
6. `410 Gone` means the trip was deleted.
7. To avoid re-downloading, send `If-None-Match: "3"` on the `GET`: `304` means it hasn't
   changed.

Only the newest 10 versions are kept (plus the published one), so history is for recent
recovery, not an archive.

## Workflow: publish (staff)

- Saving never changes what travellers see. When a version is ready,
  `PUT /v1/documents/{id}/published` with `{ "version": 4 }` → `204`. No `If-Match` needed;
  repeating it is harmless.
- To revert, publish an earlier version that is still kept. `422` means it doesn't exist,
  was pruned, or the trip was deleted.
- To take a trip offline, `DELETE /v1/documents/{id}/published` → `204`. Travellers then
  get `404`.
- Everything in a published version is visible to every traveller with the link. Internal
  notes, supplier costs or commission belong in a separate document, never in the trip.

## Workflow: share with travellers

- The link is `/doc/{id}#rk_…`: the reader key goes in the URL **fragment** (after `#`),
  which browsers never send to any server.
- The traveller client reads the key from `location.hash`, keeps it, and sends it as
  `Authorization: Bearer rk_…`. It should then remove the fragment from the address bar
  (`history.replaceState`), so the key doesn't linger in screenshots or get copied with the
  URL by accident.
- Travellers share one reader key per trip. To cut everyone off (say a link leaked), a
  manager issues a new reader key and revokes the old one (step 6), then re-sends the link.
- After the trip is created, set the reader key's expiry to some date after the trip ends
  (step 6). Extending it later reactivates it, so changed trip dates don't need a new link.

## Workflow: read a trip (travellers)

- `GET /v1/documents/{id}/published` with the reader key → `200`, the published itinerary
  and `ETag`.
- `404` means nothing is published (yet, or any more).
- On poor connections, send `If-None-Match` with the `ETag` you have: `304` means your copy
  is still current, and no body is sent. New drafts don't change the published `ETag`, so
  travellers keep getting `304` until staff publish.
- Responses are `Cache-Control: private, no-cache`: a client may keep a copy (offline
  copies for travellers are still an open decision), but must revalidate before relying on
  it.

## Errors

Errors are Problem Details (RFC 9457), `application/problem+json`:

```json
{ "type": "about:blank", "title": "Precondition Failed", "status": 412, "detail": "…" }
```

`type` is `about:blank` when the status says everything. When a client must tell problems
apart, `type` is a `/problems/…` URI, such as `/problems/document-limit-reached`. Show
`detail` to developers, not end users: it may change.

| Status | Meaning                                              | What the client should do |
| ------ | ---------------------------------------------------- | ------------------------- |
| `400`  | Malformed: invalid JSON or UTF-8, bad `If-Match`      | Fix the request (a bug)   |
| `401`  | This key doesn't work here (never says why)          | Ask for a valid key       |
| `403`  | The key works on this trip but can't do this         | Use a key with more rights |
| `404`  | Nothing published (readers)                          | Show "not available yet"  |
| `409`  | A cap was reached (see `type`)                       | Tell the user; no retry   |
| `410`  | The trip was deleted                                 | Stop editing it           |
| `412`  | Someone saved first                                  | Fetch the latest, merge, save again |
| `413`  | Body over the size limit                             | Tell the user the trip is too big |
| `415`  | Body isn't `application/json`                        | Fix the request (a bug)   |
| `422`  | Well-formed but invalid (wrong shape, unpublishable version) | Fix the request or tell the user |
| `428`  | `If-Match` missing                                   | Fix the request (a bug)   |
| `429`  | Too many requests (only if rate limiting is added)   | Wait for `Retry-After`    |
| `500`  | Server error                                         | Retry later               |

## Limits

| Limit                        | Value                          |
| ---------------------------- | ------------------------------ |
| Document size                | 200,000 bytes of UTF-8 JSON    |
| Versions kept per trip       | 10, plus the published version |
| Trips per creator key        | 100                            |
| Keys per trip                | 20                             |

The service runs on Cloudflare's free plan. If a runaway client used up the day's database
writes, every request would fail until 00:00 UTC, so clients must never save in a loop or
on every keystroke: save on an explicit action, or debounced.

## Data protection

**Never put personal data in a trip**: no traveller names, contact, passport or payment
details. The API can't detect it in free text, so the planner client should prefer
structured fields over open-ended text and tell staff the rule.

## CORS

Any origin may call the API, with no cookies or credentials. Browsers can read the `ETag`
and `Location` response headers.
