/**
 * Repository interfaces. Routes depend on these, never on the D1 implementation, and nothing
 * here knows about HTTP.
 */
import type { NewDocument, Permission } from "../models/new-document";

export interface ActiveCreatorKey {
  id: string;
  /** Documents this key has created, for the per-key cap. */
  documentCount: number;
}

export interface CreatorKeyRepository {
  /** The creator key with this hash, if it is neither revoked nor expired at `now`. */
  findActive(keyHash: Uint8Array, now: Date): Promise<ActiveCreatorKey | null>;
}

/** An active document key, as found on the document it was used on. */
export interface DocumentKeyAccess {
  keyId: string;
  permission: Permission;
  /** Approximate: updated at most hourly. */
  lastUsedAt: string | null;
}

/** Every successful document-key lookup has the key it authenticated. */
export interface AuthenticatedLookup {
  key: DocumentKeyAccess;
}

export interface VersionHead {
  version: number;
  /** A deletion marker: the document was deleted at this version. */
  deleted: boolean;
  /** When this version was saved (ISO-8601 UTC). */
  createdAt: string;
}

export interface VersionWithBody extends VersionHead {
  /** The stored JSON text; `null` exactly when `deleted`. */
  body: string | null;
}

/** What a key lookup on a document found: the key, and the document's latest version. */
export interface LatestLookup<V extends VersionHead> extends AuthenticatedLookup {
  latest: V;
}

export interface NewVersion {
  documentId: string;
  /** The version the caller edited; the save only happens if it is still the latest. */
  baseVersion: number;
  /** The number the new version gets (`nextVersion(baseVersion)`). */
  newVersion: number;
  body: string;
  createdAt: string;
  /** The document key that saved it. */
  createdBy: string;
}

export interface DocumentRepository {
  /**
   * Stores a new document, its version 1 and its keys, and records when the creator key was
   * used, all or nothing.
   */
  create(document: NewDocument): Promise<void>;

  /**
   * In one query: the active key with this hash on this document (neither revoked nor expired
   * at `now`) and the document's latest version, with its body. `null` if there is no such
   * key, which also covers a document that doesn't exist.
   */
  findLatest(
    documentId: string,
    keyHash: Uint8Array,
    now: Date,
  ): Promise<LatestLookup<VersionWithBody> | null>;

  /** As `findLatest`, without fetching the body. */
  findLatestHead(
    documentId: string,
    keyHash: Uint8Array,
    now: Date,
  ): Promise<LatestLookup<VersionHead> | null>;

  /**
   * Inserts `newVersion` if `baseVersion` is still the latest, and prunes
   * versions beyond the newest `maxVersions`, sparing the published one, in one batch.
   * `"stale"` if someone else saved first, in which case nothing was inserted.
   */
  appendVersion(version: NewVersion, maxVersions: number): Promise<"appended" | "stale">;

  /** The retained versions without bodies, newest first, and the published version number. */
  history(documentId: string): Promise<DocumentHistory>;

  /**
   * In one query: the active key with this hash on this document, version `version` with its
   * body (`null` if it isn't stored: pruned, or never existed) and the latest version number,
   * which tells those two apart. `null` if there is no such key.
   */
  findVersion(
    documentId: string,
    keyHash: Uint8Array,
    version: number,
    now: Date,
  ): Promise<VersionLookup | null>;

  /**
   * Deletes the document if `baseVersion` is still the latest and isn't a deletion marker:
   * inserts the deletion marker as `markerVersion`, removes the publication and prunes, in
   * one batch. `"stale"` if someone else wrote first, in which case nothing changed.
   */
  deleteDocument(
    deletion: Omit<NewVersion, "body" | "newVersion"> & { markerVersion: number },
    maxVersions: number,
  ): Promise<"deleted" | "stale">;
}

export interface HistoryEntry {
  version: number;
  createdAt: string;
  /** The document key that saved it; `null` for version 1, made with a creator key. */
  createdBy: string | null;
  deleted: boolean;
}

export interface DocumentHistory {
  /** Newest first. Never empty: a document always keeps at least its latest version. */
  versions: HistoryEntry[];
  /** `null` when nothing is published. */
  published: number | null;
}

export interface VersionLookup extends AuthenticatedLookup {
  latestVersion: number;
  version: VersionWithBody | null;
}

export interface PublishedVersion {
  version: number;
  /** The stored JSON text. */
  body: string;
  /** When this version was published: when what readers see last changed. */
  publishedAt: string;
}

/** What a key lookup for the published version found. */
export interface PublishedLookup extends AuthenticatedLookup {
  /** `null` when nothing is published. */
  published: PublishedVersion | null;
}

export interface NewPublication {
  documentId: string;
  version: number;
  publishedAt: string;
  /** The document key that published it. */
  publishedBy: string;
}

/** The published version is a setting, like a key: it changes, the versions it points at don't. */
export interface PublicationRepository {
  /**
   * In one query: the active key with this hash on this document, and the published version
   * with its body. `null` if there is no such key, which also covers a missing document.
   */
  findPublished(
    documentId: string,
    keyHash: Uint8Array,
    now: Date,
  ): Promise<PublishedLookup | null>;

  /**
   * Publishes the version, replacing any earlier publication, in one statement. Refused
   * (`"not-publishable"`) if the version doesn't exist, was pruned or is a deletion marker,
   * or if the document's latest version is a deletion marker.
   */
  publish(publication: NewPublication): Promise<"published" | "not-publishable">;

  /** Removes the publication, if there is one. */
  unpublish(documentId: string): Promise<void>;
}

export interface Repositories {
  creatorKeys: CreatorKeyRepository;
  documents: DocumentRepository;
  publications: PublicationRepository;
  keys: KeyRepository;
}

/** A document key's stored record, as a manager sees it. Never the key or its hash. */
export interface StoredKey {
  id: string;
  permission: Permission;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  /** The stored instant, the first one at which the key no longer works. */
  expiresAt: string | null;
  revokedAt: string | null;
}

/** What a lookup for a key-management request found: the requesting key, and its target. */
export interface KeyTargetLookup extends AuthenticatedLookup {
  /** `null` if there is no key with that ID on this document. */
  target: StoredKey | null;
}

export interface IssuedDocumentKey {
  documentId: string;
  id: string;
  keyHash: Uint8Array;
  permission: Permission;
  label: string;
  createdAt: string;
  expiresAt: string | null;
}

/**
 * Every write here also checks, in the same statement, that the requesting key is still
 * active. Two managers revoking each other at once would otherwise leave a document with no
 * working manager key; with the check, the second write finds its own key revoked.
 * `"requester-inactive"` means that happened (answer `401`).
 */
export interface KeyRepository {
  /** All the document's keys, revoked and expired ones included, oldest first. */
  list(documentId: string): Promise<StoredKey[]>;

  /**
   * In one query: the active key with this hash on this document, and the key with
   * `targetId` on the same document. `null` if there is no such active key (`401`).
   */
  findWithTarget(
    documentId: string,
    keyHash: Uint8Array,
    targetId: string,
    now: Date,
  ): Promise<KeyTargetLookup | null>;

  /** Adds the key unless the document already has `maxKeys` unrevoked keys. */
  issue(
    key: IssuedDocumentKey,
    requesterId: string,
    maxKeys: number,
  ): Promise<"issued" | "limit-reached" | "requester-inactive">;

  /** Sets or (with `null`) removes the expiry of an unrevoked, non-manager key. */
  setExpiry(change: {
    documentId: string;
    targetId: string;
    expiresAt: string | null;
    requesterId: string;
    now: Date;
  }): Promise<"updated" | "target-revoked" | "requester-inactive">;

  /** Revokes another key on the document; repeating it keeps the original time. */
  revoke(revocation: {
    documentId: string;
    targetId: string;
    requesterId: string;
    now: Date;
  }): Promise<"revoked" | "requester-inactive">;

  /** Records that the key was used, unless that was recorded within the last hour. */
  touch(keyId: string, now: Date): Promise<void>;
}
