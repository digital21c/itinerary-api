/**
 * Key expiry is given as a calendar date, YYYY-MM-DD, read in UTC. A key works through the
 * whole of that day, so it is stored as the first instant of the next day, from
 * `toISOString()`, which lets the key checks compare it as a string.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The stored `expires_at` for an expiry date, or `null` if it isn't a real YYYY-MM-DD date. */
export function expiresAtFromDate(date: string): string | null {
  const match = DATE_ONLY.exec(date);
  if (match === null) {
    return null;
  }
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];

  // Date.UTC rolls 2027-02-30 over to 2 March instead of rejecting it, so check the day exists.
  const startOfDay = new Date(Date.UTC(year, month - 1, day));
  if (startOfDay.getUTCMonth() !== month - 1 || startOfDay.getUTCDate() !== day) {
    return null;
  }

  const startOfNextDay = new Date(Date.UTC(year, month - 1, day + 1));
  return startOfNextDay.toISOString();
}

/** The last valid day (YYYY-MM-DD) for a stored `expires_at`: the inverse of `expiresAtFromDate`. */
export function dateFromExpiresAt(expiresAt: string): string {
  const lastValidInstant = new Date(new Date(expiresAt).getTime() - 1);
  return lastValidInstant.toISOString().slice(0, 10);
}

/** An expiry must be in the future. Today's date is allowed: the key works until midnight UTC. */
export function isFutureExpiry(expiresAt: string, now: Date): boolean {
  return expiresAt > now.toISOString();
}
