import { noneMatchMatches, strongTag } from "../utils/entity-tags";

/**
 * A stored version as a response: `200` with the body exactly as stored (so reads never parse
 * JSON), or `304` with no body if `If-None-Match` already names this version. The client may
 * keep a copy, but must revalidate it before reusing it (`private, no-cache`).
 */
export function versionResponse(
  version: number,
  body: string,
  ifNoneMatch: string | undefined,
): Response {
  const headers = { ETag: strongTag(String(version)), "Cache-Control": "private, no-cache" };
  if (noneMatchMatches(ifNoneMatch, String(version))) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
