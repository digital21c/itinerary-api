import { problemResponse } from "../utils/problem";

/**
 * The token from an `Authorization: Bearer <token>` header, or `null`. The scheme name is
 * case-insensitive (RFC 9110 §11.1). Keys are never accepted from the query string or path.
 */
export function bearerToken(authorization: string | undefined): string | null {
  const match = /^Bearer +(\S+)$/i.exec(authorization ?? "");
  return match?.[1] ?? null;
}

/**
 * The single `401` for every authentication failure: missing, malformed, unknown, revoked or
 * expired key, wrong kind of key, nonexistent document. It never says which, and never echoes
 * the key. `WWW-Authenticate` is required on a `401` (RFC 9110 §15.5.2, RFC 6750 §3).
 */
export function unauthorized(): Response {
  return problemResponse(
    { status: 401, title: "Unauthorized" },
    { "WWW-Authenticate": "Bearer", "Cache-Control": "no-store" },
  );
}
