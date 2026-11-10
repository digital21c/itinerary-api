import type { NewDocument, Permission } from "../../models/new-document";
import type {
  DocumentRepository,
  LatestLookup,
  NewVersion,
  VersionHead,
  VersionWithBody,
} from "../types";
import { logQueryCost } from "./query-cost";

/**
 * The key check and the latest version in one query. It starts from the key's unique hash and
 * then looks up that document's highest version through the primary key, so it reads a few
 * rows however long the history is. `{columns}` is either with or without the body.
 */
const LATEST_LOOKUP = `
  select k.id as key_id, k.permission, k.last_used_at, v.version, v.deleted{columns}
  from document_keys k
  join document_versions v
    on v.document_id = k.document_id
   and v.version = (select max(version) from document_versions where document_id = k.document_id)
  where k.key_hash = ?2
    and k.document_id = ?1
    and k.revoked_at is null
    and (k.expires_at is null or k.expires_at > ?3)`;

/** Exported so a test can check their query plans. */
export const LATEST_WITH_BODY_SQL = LATEST_LOOKUP.replace("{columns}", ", v.body");
export const LATEST_HEAD_SQL = LATEST_LOOKUP.replace("{columns}", "");

/** Inserts version `?6` only if the caller's base version `?2` is still the latest. */
export const APPEND_VERSION_SQL = `
  insert into document_versions (document_id, version, body, created_at, created_by)
  select ?1, ?6, ?3, ?4, ?5
  where (select max(version) from document_versions where document_id = ?1) = ?2`;

/** Keeps the newest `?2` versions, and the published version however old it is. */
export const PRUNE_VERSIONS_SQL = `
  delete from document_versions
  where document_id = ?1
    and version <= (select max(version) from document_versions where document_id = ?1) - ?2
    and version not in (select version from document_publications where document_id = ?1)`;

interface LatestLookupRow {
  key_id: string;
  permission: Permission;
  last_used_at: string | null;
  version: number;
  deleted: number;
  body?: string | null;
}

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
            `insert into document_keys (id, document_id, key_hash, permission, label, created_at)
             values (?1, ?2, ?3, ?4, ?5, ?6)`,
          )
          .bind(key.id, id, key.keyHash, key.permission, key.label, createdAt),
      ),
      this.db
        .prepare(`update creator_keys set last_used_at = ?1 where id = ?2`)
        .bind(createdAt, createdBy),
    ]);
    logQueryCost("documents.create", results);
  }

  async findLatest(
    documentId: string,
    keyHash: Uint8Array,
    now: Date,
  ): Promise<LatestLookup<VersionWithBody> | null> {
    const row = await this.lookUpLatest("documents.findLatest", LATEST_WITH_BODY_SQL, {
      documentId,
      keyHash,
      now,
    });
    if (row === null) {
      return null;
    }
    return { key: keyOf(row), latest: { ...headOf(row), body: row.body ?? null } };
  }

  async findLatestHead(
    documentId: string,
    keyHash: Uint8Array,
    now: Date,
  ): Promise<LatestLookup<VersionHead> | null> {
    const row = await this.lookUpLatest("documents.findLatestHead", LATEST_HEAD_SQL, {
      documentId,
      keyHash,
      now,
    });
    return row === null ? null : { key: keyOf(row), latest: headOf(row) };
  }

  async appendVersion(version: NewVersion, maxVersions: number): Promise<"appended" | "stale"> {
    const { documentId, baseVersion, newVersion, body, createdAt, createdBy } = version;

    // Both statements are safe whatever the other does: a stale insert inserts nothing, and
    // pruning without a new version only removes what was already beyond the limit.
    const results = await this.db.batch([
      this.db
        .prepare(APPEND_VERSION_SQL)
        .bind(documentId, baseVersion, body, createdAt, createdBy, newVersion),
      this.db.prepare(PRUNE_VERSIONS_SQL).bind(documentId, maxVersions),
    ]);
    logQueryCost("documents.appendVersion", results);

    return results[0]?.meta.changes === 1 ? "appended" : "stale";
  }

  private async lookUpLatest(
    queryName: string,
    sql: string,
    params: { documentId: string; keyHash: Uint8Array; now: Date },
  ): Promise<LatestLookupRow | null> {
    const result = await this.db
      .prepare(sql)
      .bind(params.documentId, params.keyHash, params.now.toISOString())
      .run<LatestLookupRow>();
    logQueryCost(queryName, [result]);
    return result.results[0] ?? null;
  }
}

function keyOf(row: LatestLookupRow): LatestLookup<VersionHead>["key"] {
  return { keyId: row.key_id, permission: row.permission, lastUsedAt: row.last_used_at };
}

function headOf(row: LatestLookupRow): VersionHead {
  return { version: row.version, deleted: row.deleted === 1 };
}
