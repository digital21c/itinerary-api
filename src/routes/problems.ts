/**
 * The API's error responses, so each status has one wording everywhere. `401` lives in
 * `auth/bearer.ts`, because it must be identical whatever went wrong.
 */
import { MAX_DOCUMENT_BYTES } from "../models/limits";
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

export function contentTooLarge(): Response {
  return problemResponse({
    status: 413,
    title: "Content Too Large",
    detail: `A document can be at most ${String(MAX_DOCUMENT_BYTES)} bytes.`,
  });
}

export function badRequest(detail: string): Response {
  return problemResponse({ status: 400, title: "Bad Request", detail });
}

export function notAnObject(): Response {
  return problemResponse({
    status: 422,
    title: "Unprocessable Content",
    detail: "A document must be a JSON object.",
  });
}
