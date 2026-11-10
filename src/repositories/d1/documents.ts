import type { NewDocument } from "../../models/new-document";
import type { DocumentRepository } from "../types";
import { logQueryCost } from "./query-cost";

export class D1DocumentRepository implements DocumentRepository {
  constructor(private readonly db: D1Database) {}

  async create(document: NewDocument): Promise<void> {
    const { id, type, createdAt, createdBy, body, keys } = document;

    // One batch is one transaction: if any statement fails, none of them is applied.
    const results = await this.db.batch([
      this.db
        .prepare(`insert into documents (id, type, created_at, created_by) values (?1, ?2, ?3, ?4)`)
        .bind(id, type, createdAt, createdBy),
      // Version 1's created_by is null: that column points at document_keys, and the creator
      // is recorded on documents.created_by.
      this.db
        .prepare(
          `insert into document_versions (document_id, version, body, created_at, created_by)
           values (?1, 1, ?2, ?3, null)`,
        )
        .bind(id, body, createdAt),
      ...keys.map((key) =>
        this.db
          .prepare(
            `insert into document_keys (id, document_id, key_hash, permission, created_at)
             values (?1, ?2, ?3, ?4, ?5)`,
          )
          .bind(key.id, id, key.keyHash, key.permission, createdAt),
      ),
      this.db
        .prepare(`update creator_keys set last_used_at = ?1 where id = ?2`)
        .bind(createdAt, createdBy),
    ]);
    logQueryCost("documents.create", results);
  }
}
