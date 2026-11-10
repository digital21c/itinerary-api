/**
 * JSON Merge Patch (RFC 7396): a patch is a JSON value describing the change. In an object,
 * a member with a value sets it (recursively, for objects), and a member that is `null`
 * removes it. Anything that isn't an object, including an array, replaces the target whole.
 *
 * Consequences worth knowing: a merge patch can't set a value to `null`, and changing one
 * element of an array means sending the whole array.
 */

type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The RFC 7396 `MergePatch(Target, Patch)` function. Neither argument is changed. */
export function applyMergePatch(target: unknown, patch: unknown): unknown {
  if (!isJsonObject(patch)) {
    return patch;
  }
  const result: JsonObject = isJsonObject(target) ? { ...target } : {};
  for (const [name, value] of Object.entries(patch)) {
    if (value === null) {
      // `delete` on a copy: this object is ours, built just above.
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete result[name];
    } else {
      // Defined, not assigned: assigning to a member named "__proto__" (which JSON allows)
      // would change the object's prototype instead of storing the value.
      Object.defineProperty(result, name, {
        value: applyMergePatch(result[name], value),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return result;
}
