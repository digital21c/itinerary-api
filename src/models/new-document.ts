import { generateKey, hashKey } from "../auth/keys";
import type { DocumentBody } from "./document-body";

export type Permission = "reader" | "editor" | "manager";

/** Every document has this type until the itinerary schema introduces others. */
export const DOCUMENT_TYPE = "itinerary";

export interface NewDocumentKey {
  id: string;
  permission: Permission;
  keyHash: Uint8Array;
}

/** What gets stored for a new document. Holds key hashes only, never the keys themselves. */
export interface NewDocument {
  id: string;
  type: typeof DOCUMENT_TYPE;
  createdAt: string;
  createdBy: string;
  /** Version 1's body, re-serialised from the parsed JSON. */
  body: string;
  keys: readonly NewDocumentKey[];
}

/** The plaintext keys, returned to the caller once and never stored. */
export interface IssuedKeys {
  managerKey: string;
  editorKey: string;
  readerKey: string;
}

/** A new document with its first manager, editor and reader keys. */
export async function planNewDocument(input: {
  body: DocumentBody;
  creatorKeyId: string;
  now: Date;
}): Promise<{ document: NewDocument; issuedKeys: IssuedKeys }> {
  const issuedKeys: IssuedKeys = {
    managerKey: generateKey("manager"),
    editorKey: generateKey("editor"),
    readerKey: generateKey("reader"),
  };

  const keys = await Promise.all(
    (
      [
        ["manager", issuedKeys.managerKey],
        ["editor", issuedKeys.editorKey],
        ["reader", issuedKeys.readerKey],
      ] as const
    ).map(async ([permission, key]) => ({
      id: crypto.randomUUID(),
      permission,
      keyHash: await hashKey(key),
    })),
  );

  return {
    document: {
      id: crypto.randomUUID(),
      type: DOCUMENT_TYPE,
      createdAt: input.now.toISOString(),
      createdBy: input.creatorKeyId,
      body: JSON.stringify(input.body),
      keys,
    },
    issuedKeys,
  };
}
