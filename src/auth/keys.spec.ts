import { describe, expect, it } from "vitest";
import { generateKey, hashKey, KEY_KINDS, recogniseKey } from "./keys";

const PREFIXES = { creator: "ck_", reader: "rk_", editor: "ek_", manager: "mk_" } as const;

describe("generateKey", () => {
  it.each(KEY_KINDS)("gives a %s key its prefix and 43 base64url characters", (kind) => {
    const key = generateKey(kind);

    expect(key.startsWith(PREFIXES[kind])).toBe(true);
    expect(key.slice(3)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("never repeats a key", () => {
    const keys = new Set(Array.from({ length: 1000 }, () => generateKey("reader")));

    expect(keys.size).toBe(1000);
  });

  it.each(KEY_KINDS)("produces a %s key that is recognised as that kind", (kind) => {
    expect(recogniseKey(generateKey(kind))).toBe(kind);
  });
});

describe("hashKey", () => {
  it("is SHA-256", async () => {
    // Test vector from FIPS 180-2.
    const hash = await hashKey("abc");

    expect(hash.toHex()).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("returns 32 bytes", async () => {
    expect(await hashKey(generateKey("editor"))).toHaveLength(32);
  });

  it("is the same for the same key and different for different keys", async () => {
    const key = generateKey("manager");

    expect(await hashKey(key)).toEqual(await hashKey(key));
    expect(await hashKey(key)).not.toEqual(await hashKey(generateKey("manager")));
  });
});

describe("recogniseKey", () => {
  const validSecret = "A".repeat(42) + "_";

  it.each([
    ["an empty string", ""],
    ["an unknown prefix", `xk_${validSecret}`],
    ["an upper-case prefix", `RK_${validSecret}`],
    ["a prefix alone", "rk_"],
    ["a secret one character short", `rk_${validSecret.slice(1)}`],
    ["a secret one character long", `rk_${validSecret}A`],
    ["base64 padding", `rk_${validSecret.slice(1)}=`],
    ["standard base64 characters", `rk_${validSecret.slice(1)}+`],
    ["leading whitespace", ` rk_${validSecret}`],
    ["trailing whitespace", `rk_${validSecret} `],
    ["a trailing newline", `rk_${validSecret}\n`],
    ["a Bearer scheme left on", `Bearer rk_${validSecret}`],
    ["a UUID", crypto.randomUUID()],
  ])("rejects %s", (_description, candidate) => {
    expect(recogniseKey(candidate)).toBeNull();
  });
});
