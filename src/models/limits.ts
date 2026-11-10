/**
 * Storage limits (decided 2026-11-10). Configuration rather than schema: changing one is a
 * deploy, not a migration. They bound storage, not request rates.
 */

/** Versions kept per document, plus the published version if it's older. */
export const MAX_VERSIONS = 10;

/** Measured on the UTF-8 request body, in bytes as Cloudflare counts them (1 KB = 1,000). */
export const MAX_DOCUMENT_BYTES = 200_000;

/** A soft cap: simultaneous creates can pass it by one or two. */
export const MAX_DOCUMENTS_PER_CREATOR_KEY = 100;

export const MAX_KEYS_PER_DOCUMENT = 20;
