import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  insertCreatorKeySql,
  type NewCreatorKey,
  parseExpiryDate,
  parseLabel,
  sqlBlob,
  sqlText,
} from "./creator-keys";

describe("parseLabel", () => {
  it("trims the label", () => {
    expect(parseLabel("  my laptop ")).toBe("my laptop");
  });

  it.each([
    ["an empty label", ""],
    ["only whitespace", "   "],
    ["a label over 100 characters", "a".repeat(101)],
    ["a newline", "my\nlaptop"],
    ["a NUL character", "my\u0000laptop"],
  ])("rejects %s", (_description, raw) => {
    expect(() => parseLabel(raw)).toThrow();
  });
});

// The date rule itself is tested in src/models/expiry.spec.ts.
describe("parseExpiryDate", () => {
  const now = new Date("2026-11-10T12:00:00.000Z");

  it("stores a date as the end of that day, UTC", () => {
    expect(parseExpiryDate("2027-01-31", now)).toBe("2027-02-01T00:00:00.000Z");
  });

  it("accepts today", () => {
    expect(parseExpiryDate("2026-11-10", now)).toBe("2026-11-11T00:00:00.000Z");
  });

  it.each([
    ["a date and time", "2027-01-31T08:30:00Z"],
    ["an impossible date", "2027-02-30"],
    ["the past", "2026-11-09"],
  ])("rejects %s", (_description, raw) => {
    expect(() => parseExpiryDate(raw, now)).toThrow();
  });
});

describe("SQL literals", () => {
  it("doubles single quotes in text", () => {
    expect(sqlText("Greg's laptop")).toBe("'Greg''s laptop'");
  });

  it("writes blobs as hex", () => {
    expect(sqlBlob(new Uint8Array([0, 15, 255]))).toBe("X'000fff'");
  });
});

describe("insertCreatorKeySql", () => {
  // D1 storage is shared by the tests in one file, so each test inserts its own key.
  function newKey(fill: number): NewCreatorKey {
    return {
      id: crypto.randomUUID(),
      keyHash: new Uint8Array(32).fill(fill),
      label: "Robert'); drop table creator_keys; --",
      createdAt: "2026-11-10T12:00:00.000Z",
      expiresAt: null,
    };
  }

  it("inserts exactly the given values into the real schema", async () => {
    const key = newKey(1);
    await env.DB.exec(insertCreatorKeySql(key));

    const row = await env.DB.prepare("select * from creator_keys where id = ?1")
      .bind(key.id)
      .first();

    expect(row).toEqual({
      id: key.id,
      key_hash: Array.from(key.keyHash),
      label: key.label,
      created_at: key.createdAt,
      last_used_at: null,
      expires_at: null,
      revoked_at: null,
    });
  });

  it("writes an expiry when there is one", async () => {
    const expiring = { ...newKey(2), expiresAt: "2027-01-31T00:00:00.000Z" };
    await env.DB.exec(insertCreatorKeySql(expiring));

    const row = await env.DB.prepare("select expires_at from creator_keys where id = ?1")
      .bind(expiring.id)
      .first<{ expires_at: string }>();

    expect(row?.expires_at).toBe("2027-01-31T00:00:00.000Z");
  });
});
