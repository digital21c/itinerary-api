import type { Permission } from "../../models/new-document";
import type { NewPublication, PublicationRepository, PublishedLookup } from "../types";
import { logQueryCost } from "./query-cost";

/**
 * The key check and the published version in one query, starting from the key's unique hash.
 * The left joins keep the key's row when nothing is published, so a valid key gets `404`
 * rather than `401`.
 */
export const FIND_PUBLISHED_SQL = `
  select k.id as key_id, k.permission, k.last_used_at, v.version, v.body, p.published_at
  from document_keys k
  left join document_publications p on p.document_id = k.document_id
  left join document_versions v on v.document_id = p.document_id and v.version = p.version
  where k.key_hash = ?2
    and k.document_id = ?1
    and k.revoked_at is null
    and (k.expires_at is null or k.expires_at > ?3)`;

/**
 * Publishes version ?2 only if it exists and isn't a deletion marker, and the document's
 * latest version isn't a deletion marker either, so a publish racing a delete can't make a
 * deleted document readable again. Replaces any earlier publication. Publishing the version
 * that is already published keeps its original time and publisher, because what readers see
 * hasn't changed: that time is their Last-Modified.
 */
export const PUBLISH_SQL = `
  insert into document_publications (document_id, version, published_at, published_by)
  select ?1, ?2, ?3, ?4
  where exists (
          select 1 from document_versions
          where document_id = ?1 and version = ?2 and deleted = 0)
    and not exists (
          select 1 from document_versions
          where document_id = ?1
            and deleted = 1
            and version = (select max(version) from document_versions where document_id = ?1))
  on conflict (document_id) do update set
    published_at = case when version = excluded.version then published_at
                        else excluded.published_at end,
    published_by = case when version = excluded.version then published_by
                        else excluded.published_by end,
    version = excluded.version`;

export const UNPUBLISH_SQL = `delete from document_publications where document_id = ?1`;

interface PublishedRow {
  key_id: string;
  permission: Permission;
  last_used_at: string | null;
  version: number | null;
  body: string | null;
  published_at: string | null;
}

export class D1PublicationRepository implements PublicationRepository {
  constructor(private readonly db: D1Database) {}

  async findPublished(
    documentId: string,
    keyHash: Uint8Array,
    now: Date,
  ): Promise<PublishedLookup | null> {
    const result = await this.db
      .prepare(FIND_PUBLISHED_SQL)
      .bind(documentId, keyHash, now.toISOString())
      .run<PublishedRow>();
    logQueryCost("publications.findPublished", [result]);

    const row = result.results[0];
    if (row === undefined) {
      return null;
    }
    const key = { keyId: row.key_id, permission: row.permission, lastUsedAt: row.last_used_at };
    return {
      key,
      published:
        row.version === null || row.body === null || row.published_at === null
          ? null
          : { version: row.version, body: row.body, publishedAt: row.published_at },
    };
  }

  async publish(publication: NewPublication): Promise<"published" | "not-publishable"> {
    const { documentId, version, publishedAt, publishedBy } = publication;
    const result = await this.db
      .prepare(PUBLISH_SQL)
      .bind(documentId, version, publishedAt, publishedBy)
      .run();
    logQueryCost("publications.publish", [result]);

    return result.meta.changes === 1 ? "published" : "not-publishable";
  }

  async unpublish(documentId: string): Promise<void> {
    const result = await this.db.prepare(UNPUBLISH_SQL).bind(documentId).run();
    logQueryCost("publications.unpublish", [result]);
  }
}
