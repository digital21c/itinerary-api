import type { Permission } from "./new-document";

/**
 * Document keys form a ladder: reader, editor, manager, each including the one before. A
 * manager could issue itself any other key, so withholding anything from it would add no
 * security.
 */
export type DocumentOperation =
  "read-published" | "read-drafts" | "write" | "publish" | "manage-keys";

const RANK: Readonly<Record<Permission, number>> = { reader: 1, editor: 2, manager: 3 };

const REQUIRED: Readonly<Record<DocumentOperation, Permission>> = {
  "read-published": "reader",
  "read-drafts": "editor",
  write: "editor",
  publish: "editor",
  "manage-keys": "manager",
};

export function allows(permission: Permission, operation: DocumentOperation): boolean {
  return RANK[permission] >= RANK[REQUIRED[operation]];
}
