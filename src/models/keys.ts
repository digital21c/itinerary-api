import { z } from "zod";
import { expiresAtFromDate, isFutureExpiry } from "./expiry";
import { labelSchema } from "./labels";
import type { Permission } from "./new-document";

/**
 * Rules for document keys as a manager manages them: status, expiry, the hourly
 * `last_used_at`, and the request bodies for issuing a key and changing its expiry.
 */

export type KeyStatus = "active" | "expired" | "revoked";

/** Revocation wins over expiry: a revoked key can never become active again. */
export function keyStatus(
  key: { revokedAt: string | null; expiresAt: string | null },
  now: Date,
): KeyStatus {
  if (key.revokedAt !== null) {
    return "revoked";
  }
  if (key.expiresAt !== null && !isFutureExpiry(key.expiresAt, now)) {
    return "expired";
  }
  return "active";
}

/** `last_used_at` is updated at most this often, so reads don't each cost a write. */
export const LAST_USED_INTERVAL_MS = 60 * 60 * 1000;

export function isLastUsedDue(lastUsedAt: string | null, now: Date): boolean {
  return lastUsedAt === null || lastUsedAt < lastUsedCutoff(now);
}

/** Anything older than this is due for an update. */
export function lastUsedCutoff(now: Date): string {
  return new Date(now.getTime() - LAST_USED_INTERVAL_MS).toISOString();
}

/** Requests to manage keys are tiny; anything bigger is not one. */
export const MAX_KEY_REQUEST_BYTES = 1_000;

export const issueKeyRequestSchema = z.strictObject({
  permission: z.enum(["reader", "editor", "manager"]),
  label: labelSchema,
  expiresAt: z.string().optional(),
});

/** `expiresAt` must be present: `null` removes the expiry (JSON Merge Patch semantics). */
export const setExpiryRequestSchema = z.strictObject({
  expiresAt: z.string().nullable(),
});

export type ExpiryChoice = { ok: true; expiresAt: string | null } | { ok: false; detail: string };

/**
 * The stored `expires_at` for an expiry date given for a key with this permission: `null`
 * (no expiry) when no date is given. Manager keys never expire, and a date can't be past.
 */
export function chooseExpiry(
  date: string | null | undefined,
  permission: Permission,
  now: Date,
): ExpiryChoice {
  if (date === null || date === undefined) {
    return { ok: true, expiresAt: null };
  }
  if (permission === "manager") {
    return { ok: false, detail: "Manager keys never expire." };
  }
  const expiresAt = expiresAtFromDate(date);
  if (expiresAt === null) {
    return { ok: false, detail: "expiresAt must be a date in the form YYYY-MM-DD." };
  }
  if (!isFutureExpiry(expiresAt, now)) {
    return { ok: false, detail: "expiresAt can't be in the past." };
  }
  return { ok: true, expiresAt };
}
