/**
 * Pure helpers for the creator-key admin scripts: input checks and SQL building.
 * No Node or Wrangler here, so they can be unit tested.
 */

export interface NewCreatorKey {
  id: string;
  keyHash: Uint8Array;
  label: string;
  createdAt: string;
  expiresAt: string | null;
}

const MAX_LABEL_LENGTH = 100;

/** A date, or a date and time with `Z` or an offset, so the time zone is never guessed. */
const ISO_8601 = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;

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

/** Normalised with `toISOString()`, so the API's string comparisons order it correctly. */
export function parseExpiresAt(raw: string, now: Date): string {
  const expiresAt = new Date(raw);
  if (!ISO_8601.test(raw) || Number.isNaN(expiresAt.getTime()) || !isCalendarDate(raw)) {
    throw new Error(`The expiry must be an ISO-8601 date, such as 2027-01-31T00:00:00Z.`);
  }
  if (expiresAt.getTime() <= now.getTime()) {
    throw new Error("The expiry must be in the future.");
  }
  return expiresAt.toISOString();
}

/** `Date` rolls 2027-02-30 over to 2 March instead of rejecting it, so check the day exists. */
function isCalendarDate(raw: string): boolean {
  const [year, month, day] = raw.slice(0, 10).split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
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
