import { describe, expect, it } from "vitest";
import { expiresAtFromDate, isFutureExpiry } from "./expiry";

describe("expiresAtFromDate", () => {
  it.each([
    ["2027-12-30", "2027-12-31T00:00:00.000Z"],
    ["2027-12-31", "2028-01-01T00:00:00.000Z"],
    ["2027-02-28", "2027-03-01T00:00:00.000Z"],
    ["2028-02-29", "2028-03-01T00:00:00.000Z"],
  ])("lets a key expiring on %s work through that whole day (UTC)", (date, expected) => {
    expect(expiresAtFromDate(date)).toBe(expected);
  });

  it.each([
    ["an empty string", ""],
    ["a date and time", "2027-12-31T00:00:00Z"],
    ["a date with a time zone", "2027-12-31Z"],
    ["day-first order", "31-12-2027"],
    ["slashes", "2027/12/31"],
    ["single-digit month and day", "2027-1-5"],
    ["month 13", "2027-13-01"],
    ["day 0", "2027-12-00"],
    ["30 February", "2027-02-30"],
    ["29 February outside a leap year", "2027-02-29"],
    ["surrounding whitespace", " 2027-12-31 "],
  ])("rejects %s", (_description, date) => {
    expect(expiresAtFromDate(date)).toBeNull();
  });
});

describe("isFutureExpiry", () => {
  const now = new Date("2026-11-10T23:59:59.999Z");

  it("accepts today's date, which lasts until midnight UTC", () => {
    expect(isFutureExpiry(expiresAtFromDate("2026-11-10") ?? "", now)).toBe(true);
  });

  it("rejects yesterday's date", () => {
    expect(isFutureExpiry(expiresAtFromDate("2026-11-09") ?? "", now)).toBe(false);
  });

  it("rejects an expiry at exactly now", () => {
    expect(isFutureExpiry(now.toISOString(), now)).toBe(false);
  });
});
