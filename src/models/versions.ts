/**
 * Version numbers: positive integers per document, starting at 1, never reused. In HTTP a
 * version is its entity tag, so `ETag: "3"` is version 3.
 */

const VERSION_NUMBER = /^[1-9][0-9]{0,14}$/;

/** A version number from its text form, or `null` (no zero, sign, leading zeros or decimals). */
export function parseVersionNumber(text: string): number | null {
  return VERSION_NUMBER.test(text) ? Number(text) : null;
}

/** The number a new version gets when saved over `baseVersion`. */
export function nextVersion(baseVersion: number): number {
  return baseVersion + 1;
}
