import { isLastUsedDue } from "../models/keys";
import type { AuthenticatedLookup, KeyRepository } from "../repositories/types";
import { isUuid } from "../utils/uuid";
import { bearerToken } from "./bearer";
import { hashKey, recogniseKey } from "./keys";

/**
 * The document key (reader, editor or manager) in the `Authorization` header, or `null`.
 * A creator key is not a document key, so it counts as unknown and gets the same `401`.
 * This only checks the shape: the key is authenticated by the repository lookup.
 */
export function documentKeyFrom(authorization: string | undefined): string | null {
  const key = bearerToken(authorization);
  if (key === null) {
    return null;
  }
  const kind = recogniseKey(key);
  return kind === "reader" || kind === "editor" || kind === "manager" ? key : null;
}

/**
 * Runs a repository lookup that authenticates a document key on a document. `null` means
 * `401`, whatever the reason: no or malformed key, a creator key, an ID that can't exist
 * (refused without a query), or a lookup that found no active key on that document.
 *
 * A key that authenticates has been used, even if the request then gets `403`, so its
 * `last_used_at` is recorded, at most hourly. That is one awaited write per key per hour:
 * simpler than `waitUntil`, which `app.request()` tests don't provide.
 */
export async function lookUpWithDocumentKey<T extends AuthenticatedLookup>(
  documentId: string,
  authorization: string | undefined,
  lookUp: (documentId: string, keyHash: Uint8Array, now: Date) => Promise<T | null>,
  keys: KeyRepository,
): Promise<T | null> {
  const key = documentKeyFrom(authorization);
  if (key === null || !isUuid(documentId)) {
    return null;
  }
  const now = new Date();
  const found = await lookUp(documentId, await hashKey(key), now);
  if (found !== null && isLastUsedDue(found.key.lastUsedAt, now)) {
    await keys.touch(found.key.keyId, now);
  }
  return found;
}
