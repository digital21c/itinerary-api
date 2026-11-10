import { bearerToken } from "./bearer";
import { recogniseKey } from "./keys";

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
