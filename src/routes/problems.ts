/**
 * The API's error responses, so each status has one wording everywhere. `401` lives in
 * `auth/bearer.ts`, because it must be identical whatever went wrong.
 */
import { problemResponse } from "../utils/problem";

export function forbidden(): Response {
  return problemResponse({
    status: 403,
    title: "Forbidden",
    detail: "This key doesn't allow this operation.",
  });
}

export function documentGone(): Response {
  return problemResponse({ status: 410, title: "Gone", detail: "The document was deleted." });
}

export function preconditionRequired(): Response {
  return problemResponse({
    status: 428,
    title: "Precondition Required",
    detail: 'Send If-Match with the version you edited, such as If-Match: "3".',
  });
}

export function malformedIfMatch(): Response {
  return problemResponse({
    status: 400,
    title: "Bad Request",
    detail: 'If-Match must be a single version tag, such as "3".',
  });
}

export function preconditionFailed(): Response {
  return problemResponse({
    status: 412,
    title: "Precondition Failed",
    detail: "Someone saved a newer version. Fetch the latest version and apply your changes to it.",
  });
}

export function unsupportedMediaType(): Response {
  return problemResponse({
    status: 415,
    title: "Unsupported Media Type",
    detail: "The body must be application/json.",
  });
}

export function contentTooLarge(maxBytes: number): Response {
  return problemResponse({
    status: 413,
    title: "Content Too Large",
    detail: `The body can be at most ${String(maxBytes)} bytes.`,
  });
}

export function badRequest(detail: string): Response {
  return problemResponse({ status: 400, title: "Bad Request", detail });
}

export function unprocessable(detail: string): Response {
  return problemResponse({ status: 422, title: "Unprocessable Content", detail });
}

export function nothingPublished(): Response {
  return problemResponse({
    status: 404,
    title: "Not Found",
    detail: "No version of this document is published.",
  });
}

export function notPublishable(): Response {
  return unprocessable(
    "That version can't be published: it doesn't exist, was pruned, or the document was deleted.",
  );
}

export function keyNotFound(): Response {
  return problemResponse({
    status: 404,
    title: "Not Found",
    detail: "There is no key with that ID on this document.",
  });
}

export function keyLimitReached(maxKeys: number): Response {
  return problemResponse({
    status: 409,
    type: "/problems/key-limit-reached",
    title: "Key limit reached",
    detail: `A document can have at most ${String(maxKeys)} unrevoked keys. Revoke one first.`,
  });
}

export function keyRevoked(): Response {
  return problemResponse({
    status: 409,
    type: "/problems/key-revoked",
    title: "Key revoked",
    detail: "A revoked key can never be reactivated. Issue a new key instead.",
  });
}

export function cannotRevokeOwnKey(): Response {
  return problemResponse({
    status: 409,
    type: "/problems/cannot-revoke-own-key",
    title: "Cannot revoke own key",
    detail:
      "A manager key can't revoke itself, so the document always keeps a working manager key. " +
      "Issue a new manager key and use it to revoke this one.",
  });
}

export function versionNotFound(): Response {
  return problemResponse({
    status: 404,
    title: "Not Found",
    detail: "This document has no version with that number.",
  });
}

export function versionPruned(): Response {
  return problemResponse({
    status: 410,
    title: "Gone",
    detail: "That version was pruned: only the newest versions and the published one are kept.",
  });
}

export function versionIsDeletionMarker(): Response {
  return problemResponse({
    status: 410,
    title: "Gone",
    detail: "That version marks the document's deletion; it has no content.",
  });
}
