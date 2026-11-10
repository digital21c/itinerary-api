/**
 * API keys: generation, hashing and recognition.
 *
 * A key is a secret, not an identifier: 32 random bytes, base64url-encoded, with a prefix
 * that tells people what kind of key it is. The prefix grants nothing. Permission always
 * comes from the key's database row, which is found by the key's SHA-256 hash.
 */

export const KEY_KINDS = ["creator", "reader", "editor", "manager"] as const;

export type KeyKind = (typeof KEY_KINDS)[number];

const PREFIX_BY_KIND: Readonly<Record<KeyKind, string>> = {
  creator: "ck_",
  reader: "rk_",
  editor: "ek_",
  manager: "mk_",
};

const KIND_BY_PREFIX: ReadonlyMap<string, KeyKind> = new Map(
  KEY_KINDS.map((kind) => [PREFIX_BY_KIND[kind], kind]),
);

const KEY_BYTES = 32;

/** A prefix, then 43 base64url characters (32 bytes, no padding). */
const KEY_PATTERN = /^(ck|rk|ek|mk)_[A-Za-z0-9_-]{43}$/;

export function generateKey(kind: KeyKind): string {
  const secret = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  return PREFIX_BY_KIND[kind] + secret.toBase64({ alphabet: "base64url", omitPadding: true });
}

/**
 * The SHA-256 hash stored in `key_hash`. A fast hash is right here: a key has 256 bits of
 * entropy, so unlike a password it can't be guessed, and slow hashes would only add CPU time.
 */
export async function hashKey(key: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return new Uint8Array(digest);
}

/**
 * The kind of key this string looks like, or `null` if it isn't shaped like a key at all.
 * Lets the API choose the right table and reject garbage without a database query.
 * Recognising a key never authenticates it.
 */
export function recogniseKey(candidate: string): KeyKind | null {
  if (!KEY_PATTERN.test(candidate)) {
    return null;
  }
  return KIND_BY_PREFIX.get(candidate.slice(0, 3)) ?? null;
}
