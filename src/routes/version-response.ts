import { noneMatchMatches, strongTag } from "../utils/entity-tags";

/** Latest and published: the client may keep a copy, but must revalidate before reusing it. */
export const REVALIDATE = "private, no-cache";

/**
 * One numbered version never changes, so a client may reuse its copy without asking again.
 * `private` because the response depends on a key.
 */
export const IMMUTABLE = "private, max-age=31536000, immutable";

/**
 * A stored version as a response: `200` with the body exactly as stored (so reads never parse
 * JSON), or `304` with no body if `If-None-Match` already names this version.
 *
 * `Last-Modified` (an HTTP date, RFC 9110 §8.8.2) is when this content last changed: the
 * version's save time, or for the published version, when it was published. It is on `304`
 * too, so a client revalidating learns it without downloading the body.
 */
export function versionResponse(
  version: number,
  body: string,
  options: { ifNoneMatch: string | undefined; lastModified: string; cacheControl?: string },
): Response {
  const headers = {
    ETag: strongTag(String(version)),
    "Last-Modified": new Date(options.lastModified).toUTCString(),
    "Cache-Control": options.cacheControl ?? REVALIDATE,
  };
  if (noneMatchMatches(options.ifNoneMatch, String(version))) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
