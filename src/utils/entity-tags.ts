/**
 * Entity tags for conditional requests (RFC 9110 §8.8.3, §13.1). Generic HTTP: the tag values
 * are opaque strings here.
 */

const ANY_TAG = /^(?:W\/)?"([\x21\x23-\x7e]*)"$/;

/** `"value"`, for an `ETag` header. */
export function strongTag(value: string): string {
  return `"${value}"`;
}

/**
 * The value of a header holding exactly one entity tag, strong or weak (`"3"` or `W/"3"`), or
 * `null` for `*`, a list or anything malformed. Whether a weak tag is acceptable is the
 * caller's decision.
 */
export function singleTagValue(header: string): string | null {
  return ANY_TAG.exec(header.trim())?.[1] ?? null;
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
