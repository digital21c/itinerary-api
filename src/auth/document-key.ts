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
 */
export async function lookUpWithDocumentKey<T>(
  documentId: string,
  authorization: string | undefined,
  lookUp: (documentId: string, keyHash: Uint8Array, now: Date) => Promise<T | null>,
): Promise<T | null> {
  const key = documentKeyFrom(authorization);
  if (key === null || !isUuid(documentId)) {
    return null;
  }
  return lookUp(documentId, await hashKey(key), new Date());
}
