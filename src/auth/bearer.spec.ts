import { describe, expect, it } from "vitest";
import { bearerToken, unauthorized } from "./bearer";

describe("bearerToken", () => {
  it.each([
    ["Bearer abc", "abc"],
    ["bearer abc", "abc"],
    ["BEARER abc", "abc"],
    ["Bearer   abc", "abc"],
  ])("reads %j", (header, expected) => {
    expect(bearerToken(header)).toBe(expected);
  });

  it.each([
    ["no header", undefined],
    ["an empty header", ""],
    ["the scheme alone", "Bearer"],
    ["the scheme and a space", "Bearer "],
    ["another scheme", "Basic abc"],
    ["no scheme", "abc"],
    ["two tokens", "Bearer abc def"],
    ["trailing whitespace", "Bearer abc "],
  ])("rejects %s", (_description, header) => {
    expect(bearerToken(header)).toBeNull();
  });
});

describe("unauthorized", () => {
  it("is a Problem Details 401 that asks for a bearer key", async () => {
    const response = unauthorized();

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    expect(await response.json()).toEqual({
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
    });
  });
});
