import { describe, expect, it } from "vitest";
import { nextVersion, parseVersionNumber } from "./versions";

describe("parseVersionNumber", () => {
  it.each([
    ["1", 1],
    ["42", 42],
    ["999999999999999", 999_999_999_999_999],
  ])("reads %s", (text, expected) => {
    expect(parseVersionNumber(text)).toBe(expected);
  });

  it.each(["", "0", "-1", "+1", "01", "1.0", "1e3", " 1", "abc", "1234567890123456"])(
    "rejects %j",
    (text) => {
      expect(parseVersionNumber(text)).toBeNull();
    },
  );
});

describe("nextVersion", () => {
  it("follows the base version", () => {
    expect(nextVersion(3)).toBe(4);
  });
});
