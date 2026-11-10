/**
 * Entity tags for conditional requests (RFC 9110 §8.8.3, §13.1). Generic HTTP: the tag values
 * are opaque strings here.
 */

const STRONG_TAG = /^"([\x21\x23-\x7e]*)"$/;
const ANY_TAG = /^(?:W\/)?"([\x21\x23-\x7e]*)"$/;

/** `"value"`, for an `ETag` header. */
export function strongTag(value: string): string {
  return `"${value}"`;
}

/**
 * The value of an `If-Match` holding exactly one strong tag, or `null`. Deliberately stricter
 * than RFC 9110: `*` and lists make no sense for "save over the version I edited".
 */
export function singleStrongTag(header: string): string | null {
  return STRONG_TAG.exec(header.trim())?.[1] ?? null;
}

/**
 * Whether `If-None-Match` matches the current tag, so the answer is `304`. Uses weak
 * comparison, as RFC 9110 §13.1.2 requires: `W/"3"` matches `"3"`. Accepts `*` and lists.
 */
export function noneMatchMatches(header: string | undefined, current: string): boolean {
  if (header === undefined) {
    return false;
  }
  return header.split(",").some((entry) => {
    const trimmed = entry.trim();
    return trimmed === "*" || ANY_TAG.exec(trimmed)?.[1] === current;
  });
}
