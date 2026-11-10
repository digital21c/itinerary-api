import { describe, expect, it } from "vitest";
import { allows, type DocumentOperation } from "./permissions";
import type { Permission } from "./new-document";

// The operations table in CLAUDE.md, row by row.
const TABLE: Record<DocumentOperation, readonly Permission[]> = {
  "read-published": ["reader", "editor", "manager"],
  "read-drafts": ["editor", "manager"],
  write: ["editor", "manager"],
  publish: ["editor", "manager"],
  "manage-keys": ["manager"],
};

const PERMISSIONS: readonly Permission[] = ["reader", "editor", "manager"];

describe("allows", () => {
  for (const [operation, allowed] of Object.entries(TABLE) as [
    DocumentOperation,
    readonly Permission[],
  ][]) {
    for (const permission of PERMISSIONS) {
      const expected = allowed.includes(permission);
      it(`${expected ? "lets" : "doesn't let"} a ${permission} key ${operation}`, () => {
        expect(allows(permission, operation)).toBe(expected);
      });
    }
  }
});
