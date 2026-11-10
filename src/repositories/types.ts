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
}

export interface VersionHead {
  version: number;
  /** A deletion marker: the document was deleted at this version. */
  deleted: boolean;
}

export interface VersionWithBody extends VersionHead {
  /** The stored JSON text; `null` exactly when `deleted`. */
  body: string | null;
}

/** What a key lookup on a document found: the key, and the document's latest version. */
export interface LatestLookup<V extends VersionHead> {
  key: DocumentKeyAccess;
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
}

export interface PublishedVersion {
  version: number;
  /** The stored JSON text. */
  body: string;
}

/** What a key lookup for the published version found. */
export interface PublishedLookup {
  key: DocumentKeyAccess;
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
}
