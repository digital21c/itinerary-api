import { describe, expect, it } from "vitest";
import { applyMergePatch } from "./merge-patch";

describe("applyMergePatch", () => {
  // Every example in RFC 7396 Appendix A, in order: [target, patch, result].
  it.each([
    [{ a: "b" }, { a: "c" }, { a: "c" }],
    [{ a: "b" }, { b: "c" }, { a: "b", b: "c" }],
    [{ a: "b" }, { a: null }, {}],
    [{ a: "b", b: "c" }, { a: null }, { b: "c" }],
    [{ a: ["b"] }, { a: "c" }, { a: "c" }],
    [{ a: "c" }, { a: ["b"] }, { a: ["b"] }],
    [{ a: { b: "c" } }, { a: { b: "d", c: null } }, { a: { b: "d" } }],
    [{ a: [{ b: "c" }] }, { a: [1] }, { a: [1] }],
    [
      ["a", "b"],
      ["c", "d"],
      ["c", "d"],
    ],
    [{ a: "b" }, ["c"], ["c"]],
    [{ a: "foo" }, null, null],
    [{ a: "foo" }, "bar", "bar"],
    [{ e: null }, { a: 1 }, { e: null, a: 1 }],
    [[1, 2], { a: "b", c: null }, { a: "b" }],
    [{}, { a: { bb: { ccc: null } } }, { a: { bb: {} } }],
  ])("RFC 7396 example %#", (target, patch, expected) => {
    expect(applyMergePatch(target, patch)).toEqual(expected);
  });

  // The example in RFC 7396 section 3.
  it("applies the RFC's worked example", () => {
    const target = {
      title: "Goodbye!",
      author: { givenName: "John", familyName: "Doe" },
      tags: ["example", "sample"],
      content: "This will be unchanged",
    };
    const patch = {
      title: "Hello!",
      phoneNumber: "+01-123-456-7890",
      author: { familyName: null },
      tags: ["example"],
    };

    expect(applyMergePatch(target, patch)).toEqual({
      title: "Hello!",
      author: { givenName: "John" },
      tags: ["example"],
      content: "This will be unchanged",
      phoneNumber: "+01-123-456-7890",
    });
  });

  it('stores a member named "__proto__" as data, never as a prototype', () => {
    const patch = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}') as unknown;

    const result = applyMergePatch({}, patch);

    expect(JSON.stringify(result)).toBe('{"__proto__":{"polluted":true},"a":1}');
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("changes neither argument", () => {
    const target = { a: { b: 1 }, c: 2 };
    const patch = { a: { b: null }, c: 3 };

    applyMergePatch(target, patch);

    expect(target).toEqual({ a: { b: 1 }, c: 2 });
    expect(patch).toEqual({ a: { b: null }, c: 3 });
  });
});
