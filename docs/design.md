# Itinerary API: Design

The logical design: what the API does and why. It is shared by the backend and the
front-end (`dev/itinerary-web`), so it describes behaviour, never implementation. Backend
internals live in [implementation.md](implementation.md); the HTTP contract (every endpoint,
header, status and schema) is [`openapi.yaml`](../openapi.yaml); how a client uses it is
[api-guide.md](api-guide.md); why each decision was made is [decisions.md](decisions.md).

## Purpose

A central store of JSON documents, reached through an HTTP API. The documents are travel
itineraries ("trips"). A trip is created by a travel planner, agent or arranger, who gives
staff and colleagues manager and editor rights on that particular trip. Travellers share
one common reader key, delivered by link, and see only what has been published.

There are no user accounts, passwords, sessions or cookies. There is no cross-document
listing or search: with no users there is no "my documents", and no agency level or
collection of trips, because staff work on particular trips.

# Security Model

Capability-based access: **holding a key is the permission.**

## Keys

| Key     | Prefix | Scope            | Allows                                                 |
| ------- | ------ | ---------------- | ------------------------------------------------------ |
| Creator | `ck_`  | The whole system | Creating documents, nothing else                       |
| Reader  | `rk_`  | One document     | Reading its published version, nothing else            |
| Editor  | `ek_`  | One document     | All reader actions, plus drafts, history, new versions, publishing and deleting |
| Manager | `mk_`  | One document     | All editor actions, plus listing, issuing and revoking keys |

| Operation                                       | Key required               |
| ----------------------------------------------- | -------------------------- |
| Create a document                               | Creator                    |
| Read the published version                      | Reader, editor or manager  |
| Read the latest version, history or one version | Editor or manager          |
| New version, `PATCH`, `DELETE` a document       | Editor or manager          |
| Publish or unpublish                            | Editor or manager          |
| List, issue, change expiry of or revoke keys    | Manager                    |
| Creator keys, lost-key recovery, purging        | Admin script (not the API) |

- Document keys form a ladder: reader, editor, manager, each including the one before. A
  manager could issue itself any other key, so withholding read or edit would add no security.
- A creator key can't read or edit any document, even ones it created. A leak can only add
  documents, and each document records which creator key made it.
- Keys are secrets, not identifiers: 32 random bytes, base64url-encoded, with the prefix
  above. The prefix only helps people recognise a key; permission always comes from the
  server's record of it.
- **A key is shown once, when it is issued, and can never be retrieved.** The server stores
  only a hash of it. A client that loses a key can't get it back from the API.
- Staff work on particular trips, never whole collections, so all staff keys are per trip.
  Issue one labelled key per person per trip, so someone can be revoked from a trip without
  affecting anyone else.
- A document's ID is public. Keys are sent separately, so a key can be replaced without the
  document's address changing.
- Every key a manager issues has a label of 1–100 characters. **Labels name a role and a
  device ("Kyoto desk – laptop"), never a person**: a name would be personal data. The API
  can't enforce this, so the planner client must tell staff. A trip's three initial keys are
  labelled "Initial manager key", "Initial editor key" and "Initial reader key".
- A document can have at most 20 unrevoked keys. Expired keys count, because they can be
  reactivated; revoked keys don't, because they can't.

## Managing keys

- Only a manager key can list, issue, change the expiry of or revoke a document's keys.
- The key list shows every key on the document, revoked and expired ones included, so it is
  a record of who had access: its ID, permission, label, when it was created, when it was
  last used, its expiry (the last valid day), when it was revoked, its status (`active`,
  `expired` or `revoked`) and whether it is the key making the request. It never shows a key
  or its hash.
- "Last used" is approximate: it is recorded at most once an hour per key, so a trip's
  shared reader key costs at most 24 writes a day however many travellers use it. A request
  counts as use once the key authenticates, even if it is then refused with `403`.
- Issuing a key returns it once. Keys can't be issued on a deleted document (`410`), but
  keys can still be revoked or have their expiry changed there: cutting off access is always
  safe.
- Key-management requests need no `If-Match`: each states the whole intended result.

## Requests

- Keys travel only in `Authorization: Bearer <key>`, never in the query string or path.
- The travellers' shared link puts the reader key in the URL fragment (`/doc/{id}#rk_…`);
  the client moves it into the header. Fragments never reach the server.
- Keys are never logged and never echoed in an error.
- A missing, malformed, unknown, revoked or expired key and a nonexistent document all get
  the same `401`, which reveals nothing about why. A valid document key without enough
  permission gets `403`. A creator key used on a document, or a document key used to
  create, counts as unknown: `401`.
- Headers rather than cookies means CSRF doesn't apply, and CORS allows any origin: with no
  ambient credentials, CORS would protect nothing.
- No rate limiting at first, by decision (see Hosting And Availability).

## Revocation

- A manager key revokes any other key on its document, by the key's public `id`. It can't
  touch keys on another document: a key `id` that isn't on this document gets `404`.
- Revoking twice is safe and keeps the original revocation time.
- A manager key can't revoke itself (`409`, `/problems/cannot-revoke-own-key`), so a
  document always keeps a working manager key. To replace a manager key, issue a new one,
  then use it to revoke the old one.
- Every key-management change checks, as part of the change itself, that the manager's own
  key is still active at that moment. Without this, two managers revoking each other at the
  same moment could both succeed and leave the trip with no working manager key; with it,
  the second finds its own key revoked and gets `401`. It also stops a manager who has just
  been revoked from issuing themselves a new key in the gap.
- Replacing any key = issue a new one, then revoke the old one.
- Revocation is immediate. It only stops future access: anything already read can't be
  taken back.
- Key records are never deleted (except when a whole document is purged), and every version
  records which key saved it, so you can see what a leaked key wrote and restore the last
  good version.
- Revoking a creator key doesn't affect the documents it made: their keys keep working.

## Expiry

- Creator, reader and editor keys can have an optional expiry. An expired key gets the same
  `401` as an unknown one.
- **Manager keys never expire.** Otherwise a document could silently lose its last working
  manager key. Leavers are handled by revocation.
- Expiry is a calendar date, `YYYY-MM-DD`, read in UTC. The key works through the whole of
  that day: a key expiring `2027-12-31` stops at `2028-01-01T00:00:00Z`.
- A manager sets expiry when issuing a key, or later with a JSON Merge Patch
  (`{ "expiresAt": "2027-12-31" }`, or `null` to remove it). It can't be in the past
  (`422`), but today's date is allowed. Giving a manager key an expiry is `422`. Keys start
  with no expiry, so the client sets the shared reader key's expiry after creating the trip,
  some time after the trip ends.
- Extending a key reactivates it if it has expired, so trip dates can change without
  re-sending the travellers' link. A revoked key can never be reactivated: changing its
  expiry is `409`, `/problems/key-revoked`.

## Outside the API

Done by hand by the operator with admin scripts, adding nothing to the public API:

- Issuing, expiring and revoking creator keys. Nothing sits above them in the API, and the
  first one can't come through the API at all.
- Recovering a document whose manager key is lost, by inserting a replacement key.
- Purging a document or version for good. Because purging isn't in the API, a leaked
  manager key can't destroy history for good.

Access to the Cloudflare account bypasses every key; it is the real power in the system.

## Rejected for now

- End-to-end encryption with the reader key: loses server-side validation, merge patch and
  queries, and a lost key means lost data. Could return later as a new storage version.

# Documents And Versions

- Document content is **never changed in place**. Every save stores a new full copy with the
  next version number. Version numbers start at 1, increase per document, and are never
  reused or renumbered.
- The latest version is the working draft. Editors read it with its version number (as an
  `ETag`) and save over it by naming that version (`If-Match`). If someone else saved first,
  the save is refused with `412`, so no one's changes are silently lost.
- Editors can also change part of the latest version with a JSON Merge Patch (RFC 7396): a
  member with a value sets it, `null` removes it, arrays are replaced whole. The result is
  stored as a new full version, exactly like a save.
- Deleting a document needs `If-Match` naming the latest version, like a save, so no one
  deletes a version they haven't seen. It stores a deletion-marker version and unpublishes
  the document. While deleted, it can't be edited, published or given new keys, and editors
  reading its latest version get `410 Gone`.
- **A deleted document can be restored** by an editor or manager until it is purged.
  Restoring is a save whose `If-Match` names the deletion marker, usually with the body of
  an earlier version from the history, which stays readable to editors while the document
  is deleted. A restored document is unpublished: readers get `404` until someone publishes
  again. Its keys work as before, and keys revoked meanwhile stay revoked.
- Keys and the publication are settings that can change; version content never does.
- The latest version and the published version have separate URLs, so one URL never returns
  different content depending on which key asks.
- The history lists the retained versions newest first, without bodies: number, date, which
  key saved it, and whether it is a deletion marker, plus the latest, the oldest still
  available and the published version. It holds at most 11 entries (10 plus the published
  one), so it isn't paginated.
- A single version never changes, so it can be cached for good
  (`Cache-Control: private, max-age=31536000, immutable`; `private` because responses depend
  on a key). A pruned version and a deletion marker are `410 Gone`; a number above the
  latest is `404`.

## Publishing

- Saving a version never changes what travellers see. An editor publishes one specific
  version, so what goes live is exactly what was reviewed, not whatever is newest.
- A reader key sees only the published version: never drafts, history or deletion markers.
  A new document is unpublished, so its reader key gets `404` until someone publishes.
- Publishing is idempotent and needs no `If-Match`: it states the whole intended result.
  Reverting = publishing an earlier retained version. Unpublishing makes readers get `404`.
- Deleting a document also unpublishes it, so readers lose access at once.
- **The document is the security boundary.** Anything in a published version is visible to
  every traveller with the link. Supplier costs, commission or internal notes can't be
  hidden inside a published version, so they belong in a separate document.

## Retention

- Each document keeps only its newest 10 versions, plus the published version if it is
  older. Older versions are pruned automatically when a new one is saved; a pruned version
  is `410 Gone`.
- Deletion markers count as versions.
- A leaked editor key could flush good history by saving junk versions, and nothing
  throttles that at first. Pruning always spares the published version, and the database's
  point-in-time restore (7 days on the free plan) is the last-resort backstop.
- Pruned and purged data stays restorable by the operator for those 7 days; deletion is
  complete only after that window.

# Limits

These bound storage, not request rates, so they apply from the start.

| Limit                           | Value                                                 | When exceeded           |
| ------------------------------- | ----------------------------------------------------- | ----------------------- |
| Versions kept per document      | 10, plus the published version                        | Oldest pruned           |
| Document size                   | 200,000 bytes of UTF-8 JSON                           | `413`                   |
| Documents per creator key       | 100 (a soft cap: simultaneous creates can pass it by one or two) | `409` (`/problems/document-limit-reached`) |
| Unrevoked keys per document     | 20 (expired keys count; revoked ones don't)           | `409` (`/problems/key-limit-reached`) |
| Publish and key-management request size | 1,000 bytes                                   | `413`                   |

At 200 KB and 10 versions a document can reach 2 MB, so about 250 documents could fill the
500 MB free database; one creator key's full cap is 200 MB.

# Hosting And Availability

Cloudflare Workers Free with D1, deliberately: going over a limit causes errors, never a
bill. Moving to a paid plan removes that hard stop, so cost protection must be revisited
first.

The accepted risk is availability. The free plan allows 100,000 database writes a day; a
runaway client or leaked key could use them up, and then **every request fails, for all
trips and travellers, until 00:00 UTC.** If that happens, rate limiting will be added,
keyed on the document or key rather than the IP address (a whole office or tour group can
share one address), and clients will then see `429 Too Many Requests` with `Retry-After`.

# Data Protection

- **Documents never contain personal data**: no traveller names, contact, passport or
  payment details. The API can't detect personal data typed into free text, so trip
  document schemas should avoid open-ended text where they can, and the planner client
  must tell staff the rule.
- If throttling is added later, any IP addresses kept for it count as personal data under
  GDPR and are kept only briefly.
