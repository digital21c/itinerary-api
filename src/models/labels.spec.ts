import { describe, expect, it } from "vitest";
import { normaliseLabel } from "./labels";

describe("normaliseLabel", () => {
  it.each([
    ["Kyoto desk – laptop", "Kyoto desk – laptop"],
    ["  phone app ", "phone app"],
    ["x".repeat(100), "x".repeat(100)],
  ])("accepts %j", (raw, expected) => {
    expect(normaliseLabel(raw)).toBe(expected);
  });

  it.each([
    ["an empty label", ""],
    ["only whitespace", "   "],
    ["over 100 characters", "x".repeat(101)],
    ["a newline", "phone\napp"],
    ["a tab", "phone\tapp"],
    ["a NUL character", "phone\u0000app"],
  ])("rejects %s", (_description, raw) => {
    expect(normaliseLabel(raw)).toBeNull();
  });
});
