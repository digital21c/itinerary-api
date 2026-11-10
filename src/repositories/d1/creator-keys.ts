import type { ActiveCreatorKey, CreatorKeyRepository } from "../types";
import { logQueryCost } from "./query-cost";

interface ActiveCreatorKeyRow {
  id: string;
  document_count: number;
}

export class D1CreatorKeyRepository implements CreatorKeyRepository {
  constructor(private readonly db: D1Database) {}

  async findActive(keyHash: Uint8Array, now: Date): Promise<ActiveCreatorKey | null> {
    // key_hash is unique (indexed), and the count uses documents_created_by.
    const result = await this.db
      .prepare(
        `select k.id,
                (select count(*) from documents d where d.created_by = k.id) as document_count
         from creator_keys k
         where k.key_hash = ?1
           and k.revoked_at is null
           and (k.expires_at is null or k.expires_at > ?2)`,
      )
      .bind(keyHash, now.toISOString())
      .run<ActiveCreatorKeyRow>();
    logQueryCost("creator-keys.findActive", [result]);

    const row = result.results[0];
    return row === undefined ? null : { id: row.id, documentCount: row.document_count };
  }
}
