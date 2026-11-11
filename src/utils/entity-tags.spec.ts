import { describe, expect, it } from "vitest";
import { noneMatchMatches, singleTagValue, strongTag } from "./entity-tags";

describe("strongTag", () => {
  it("quotes the value", () => {
    expect(strongTag("3")).toBe('"3"');
  });
});

describe("singleTagValue", () => {
  it.each([
    ['"3"', "3"],
    [' "3" ', "3"],
    ['"abc"', "abc"],
    ['W/"3"', "3"],
  ])("reads %j", (header, expected) => {
    expect(singleTagValue(header)).toBe(expected);
  });

  it.each([
    ["an unquoted value", "3"],
    ["a lower-case weak prefix", 'w/"3"'],
    ["any version", "*"],
    ["a list", '"3", "4"'],
    ["an empty header", ""],
    ["a quote inside", '"3"4"'],
  ])("rejects %s", (_description, header) => {
    expect(singleTagValue(header)).toBeNull();
  });
});

describe("noneMatchMatches", () => {
  it.each([
    ["the same tag", '"3"'],
    ["a weak tag with the same value", 'W/"3"'],
    ["any tag", "*"],
    ["a list containing it", '"1", W/"3", "5"'],
  ])("matches %s", (_description, header) => {
    expect(noneMatchMatches(header, "3")).toBe(true);
  });

  it.each([
    ["no header", undefined],
    ["another tag", '"2"'],
    ["a list without it", '"1", "2"'],
    ["an unquoted value", "3"],
    ["a longer number", '"33"'],
  ])("doesn't match %s", (_description, header) => {
    expect(noneMatchMatches(header, "3")).toBe(false);
  });
});
