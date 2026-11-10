import { describe, expect, it } from "vitest";
import { publishRequestSchema } from "./publication";

describe("publishRequestSchema", () => {
  it("accepts a positive integer version", () => {
    expect(publishRequestSchema.parse({ version: 3 })).toEqual({ version: 3 });
  });

  it.each([
    ["no version", {}],
    ["version 0", { version: 0 }],
    ["a negative version", { version: -1 }],
    ["a fractional version", { version: 3.5 }],
    ["a version as text", { version: "3" }],
    ["an unsafe integer", { version: 2 ** 53 }],
    ["an extra field", { version: 3, publishedAt: "now" }],
    ["an array", [3]],
    ["null", null],
  ])("rejects %s", (_description, body) => {
    expect(publishRequestSchema.safeParse(body).success).toBe(false);
  });
});
