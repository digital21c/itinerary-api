import { describe, expect, it } from "vitest";
import {
  chooseExpiry,
  isLastUsedDue,
  issueKeyRequestSchema,
  keyStatus,
  setExpiryRequestSchema,
} from "./keys";

const now = new Date("2026-11-10T12:00:00.000Z");

describe("keyStatus", () => {
  it.each([
    ["no expiry", { revokedAt: null, expiresAt: null }, "active"],
    ["a future expiry", { revokedAt: null, expiresAt: "2026-11-11T00:00:00.000Z" }, "active"],
    ["a past expiry", { revokedAt: null, expiresAt: "2026-11-10T00:00:00.000Z" }, "expired"],
    ["revocation", { revokedAt: "2026-11-01T00:00:00.000Z", expiresAt: null }, "revoked"],
    [
      "revocation and expiry",
      { revokedAt: "2026-11-01T00:00:00.000Z", expiresAt: "2026-11-05T00:00:00.000Z" },
      "revoked",
    ],
  ] as const)("calls a key with %s %s", (_description, key, expected) => {
    expect(keyStatus(key, now)).toBe(expected);
  });
});

describe("isLastUsedDue", () => {
  it.each([
    ["never used", null, true],
    ["used a minute ago", "2026-11-10T11:59:00.000Z", false],
    ["used exactly an hour ago", "2026-11-10T11:00:00.000Z", false],
    ["used just over an hour ago", "2026-11-10T10:59:59.999Z", true],
  ])("is %s: %s", (_description, lastUsedAt, expected) => {
    expect(isLastUsedDue(lastUsedAt, now)).toBe(expected);
  });
});

describe("chooseExpiry", () => {
  it("means no expiry when no date is given", () => {
    expect(chooseExpiry(undefined, "reader", now)).toEqual({ ok: true, expiresAt: null });
    expect(chooseExpiry(null, "manager", now)).toEqual({ ok: true, expiresAt: null });
  });

  it("stores a date as the end of that day", () => {
    expect(chooseExpiry("2027-04-30", "editor", now)).toEqual({
      ok: true,
      expiresAt: "2027-05-01T00:00:00.000Z",
    });
  });

  it("allows today", () => {
    expect(chooseExpiry("2026-11-10", "reader", now).ok).toBe(true);
  });

  it.each([
    ["a manager key", "2027-04-30", "manager"],
    ["a past date", "2026-11-09", "reader"],
    ["a date and time", "2027-04-30T00:00:00Z", "reader"],
    ["an impossible date", "2027-02-30", "editor"],
  ] as const)("refuses %s", (_description, date, permission) => {
    expect(chooseExpiry(date, permission, now).ok).toBe(false);
  });
});

describe("issueKeyRequestSchema", () => {
  it("accepts a permission and label, with an optional date", () => {
    expect(issueKeyRequestSchema.parse({ permission: "reader", label: " Tour group " })).toEqual({
      permission: "reader",
      label: "Tour group",
    });
  });

  it.each([
    ["no label", { permission: "reader" }],
    ["an empty label", { permission: "reader", label: " " }],
    ["no permission", { label: "x" }],
    ["a creator permission", { permission: "creator", label: "x" }],
    ["an extra field", { permission: "reader", label: "x", key: "rk_…" }],
    ["a numeric date", { permission: "reader", label: "x", expiresAt: 20270430 }],
  ])("rejects %s", (_description, body) => {
    expect(issueKeyRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe("setExpiryRequestSchema", () => {
  it.each([{ expiresAt: "2027-04-30" }, { expiresAt: null }])("accepts %j", (body) => {
    expect(setExpiryRequestSchema.safeParse(body).success).toBe(true);
  });

  it.each([{}, { expiresAt: 1 }, { expiresAt: null, label: "x" }])("rejects %j", (body) => {
    expect(setExpiryRequestSchema.safeParse(body).success).toBe(false);
  });
});
