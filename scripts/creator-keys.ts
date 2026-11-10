/**
 * Pure helpers for the creator-key admin scripts: input checks and SQL building.
 * No Node or Wrangler here, so they can be unit tested.
 */
import { expiresAtFromDate, isFutureExpiry } from "../src/models/expiry.ts";

export interface NewCreatorKey {
  id: string;
  keyHash: Uint8Array;
  label: string;
  createdAt: string;
  expiresAt: string | null;
}

const MAX_LABEL_LENGTH = 100;

export function parseLabel(raw: string): string {
  const label = raw.trim();
  if (label.length === 0 || label.length > MAX_LABEL_LENGTH) {
    throw new Error(`The label must be 1 to ${String(MAX_LABEL_LENGTH)} characters.`);
  }
  if (/\p{Cc}/u.test(label)) {
    throw new Error("The label can't contain control characters.");
  }
  return label;
}

/** The stored `expires_at` for an expiry date (YYYY-MM-DD, UTC), using the API's own rule. */
export function parseExpiryDate(raw: string, now: Date): string {
  const expiresAt = expiresAtFromDate(raw);
  if (expiresAt === null) {
    throw new Error("The expiry must be a date in the form YYYY-MM-DD, such as 2027-12-31.");
  }
  if (!isFutureExpiry(expiresAt, now)) {
    throw new Error("The expiry date can't be in the past.");
  }
  return expiresAt;
}

/**
 * `wrangler d1 execute --command` takes plain SQL with no bound parameters, so values are
 * written as literals. Only the hash is included: the plaintext key never reaches the database.
 */
export function insertCreatorKeySql(key: NewCreatorKey): string {
  const values = [
    sqlText(key.id),
    sqlBlob(key.keyHash),
    sqlText(key.label),
    sqlText(key.createdAt),
    key.expiresAt === null ? "null" : sqlText(key.expiresAt),
  ];
  return (
    "insert into creator_keys (id, key_hash, label, created_at, expires_at) " +
    `values (${values.join(", ")});`
  );
}

/** A SQLite string literal: single quotes, with any quote inside doubled. */
export function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** A SQLite blob literal, X'…' in hex. */
export function sqlBlob(bytes: Uint8Array): string {
  return `X'${bytes.toHex()}'`;
}
