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
