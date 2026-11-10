/**
 * Repository interfaces. Routes depend on these, never on the D1 implementation, and nothing
 * here knows about HTTP.
 */
import type { NewDocument } from "../models/new-document";

export interface ActiveCreatorKey {
  id: string;
  /** Documents this key has created, for the per-key cap. */
  documentCount: number;
}

export interface CreatorKeyRepository {
  /** The creator key with this hash, if it is neither revoked nor expired at `now`. */
  findActive(keyHash: Uint8Array, now: Date): Promise<ActiveCreatorKey | null>;
}

export interface DocumentRepository {
  /**
   * Stores a new document, its version 1 and its keys, and records when the creator key was
   * used, all or nothing.
   */
  create(document: NewDocument): Promise<void>;
}

export interface Repositories {
  creatorKeys: CreatorKeyRepository;
  documents: DocumentRepository;
}
