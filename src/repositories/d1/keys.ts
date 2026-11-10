import { lastUsedCutoff } from "../../models/keys";
import type { Permission } from "../../models/new-document";
import type { IssuedDocumentKey, KeyRepository, KeyTargetLookup, StoredKey } from "../types";
import { logQueryCost } from "./query-cost";

/**
 * "The requesting key is still active", as a condition inside each write. A check in an
 * earlier query can't protect the invariant that a document always keeps a working manager
 * key: two managers revoking each other could both pass it. D1 runs statements one at a
 * time, so with this condition the second revocation finds its own key revoked.
 * Parameters: {requester}, {document}, {now}.
 */
const REQUESTER_IS_ACTIVE = `exists (
    select 1 from document_keys
    where id = {requester} and document_id = {document}
      and revoked_at is null and (expires_at is null or expires_at > {now}))`;

function requesterIsActive(requester: string, document: string, now: string): string {
  return REQUESTER_IS_ACTIVE.replace("{requester}", requester)
    .replace("{document}", document)
    .replace("{now}", now);
}

const KEY_COLUMNS = "id, permission, label, created_at, last_used_at, expires_at, revoked_at";

export const LIST_KEYS_SQL = `
  select ${KEY_COLUMNS} from document_keys
  where document_id = ?1
  order by created_at, id`;

/**
 * The requesting key (active, on this document) and the target key on the same document, in
 * one query. Requiring the same document is what stops a manager touching another trip's keys.
 */
export const FIND_WITH_TARGET_SQL = `
  select r.id as requester_id, r.permission as requester_permission,
         r.last_used_at as requester_last_used_at,
         t.id, t.permission, t.label, t.created_at, t.last_used_at, t.expires_at, t.revoked_at
  from document_keys r
  left join document_keys t on t.document_id = r.document_id and t.id = ?3
  where r.key_hash = ?2
    and r.document_id = ?1
    and r.revoked_at is null
    and (r.expires_at is null or r.expires_at > ?4)`;

/** Exact cap: the count and the insert are one statement. Revoked keys don't count. */
export const ISSUE_KEY_SQL = `
  insert into document_keys (id, document_id, key_hash, permission, label, created_at, expires_at)
  select ?1, ?2, ?3, ?4, ?5, ?6, ?7
  where (select count(*) from document_keys where document_id = ?2 and revoked_at is null) < ?8
    and ${requesterIsActive("?9", "?2", "?6")}`;

/** A revoked key can never be reactivated, and a manager key can never be given an expiry. */
export const SET_EXPIRY_SQL = `
  update document_keys set expires_at = ?1
  where id = ?2
    and document_id = ?3
    and revoked_at is null
    and (permission <> 'manager' or ?1 is null)
    and ${requesterIsActive("?4", "?3", "?5")}`;

/** `coalesce` makes a repeat safe and keeps the original time. Never the requester's own key. */
export const REVOKE_KEY_SQL = `
  update document_keys set revoked_at = coalesce(revoked_at, ?1)
  where id = ?2
    and document_id = ?3
    and id <> ?4
    and ${requesterIsActive("?4", "?3", "?1")}`;

export const REQUESTER_IS_ACTIVE_SQL = `select ${requesterIsActive("?1", "?2", "?3")} as active`;

/** At most one write per key per hour, however many requests use it. */
export const TOUCH_KEY_SQL = `
  update document_keys set last_used_at = ?2
  where id = ?1 and (last_used_at is null or last_used_at < ?3)`;

interface KeyRow {
  id: string;
  permission: Permission;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

interface WithTargetRow extends Omit<KeyRow, "id" | "permission" | "created_at"> {
  requester_id: string;
  requester_permission: Permission;
  requester_last_used_at: string | null;
  id: string | null;
  permission: Permission | null;
  created_at: string | null;
}

function storedKeyOf(row: KeyRow): StoredKey {
  return {
    id: row.id,
    permission: row.permission,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export class D1KeyRepository implements KeyRepository {
  constructor(private readonly db: D1Database) {}

  async list(documentId: string): Promise<StoredKey[]> {
    const result = await this.db.prepare(LIST_KEYS_SQL).bind(documentId).run<KeyRow>();
    logQueryCost("keys.list", [result]);
    return result.results.map(storedKeyOf);
  }

  async findWithTarget(
    documentId: string,
    keyHash: Uint8Array,
    targetId: string,
    now: Date,
  ): Promise<KeyTargetLookup | null> {
    const result = await this.db
      .prepare(FIND_WITH_TARGET_SQL)
      .bind(documentId, keyHash, targetId, now.toISOString())
      .run<WithTargetRow>();
    logQueryCost("keys.findWithTarget", [result]);

    const row = result.results[0];
    if (row === undefined) {
      return null;
    }
    const key = {
      keyId: row.requester_id,
      permission: row.requester_permission,
      lastUsedAt: row.requester_last_used_at,
    };
    const target =
      row.id === null || row.permission === null || row.created_at === null
        ? null
        : storedKeyOf({
            ...row,
            id: row.id,
            permission: row.permission,
            created_at: row.created_at,
          });
    return { key, target };
  }

  async issue(
    key: IssuedDocumentKey,
    requesterId: string,
    maxKeys: number,
  ): Promise<"issued" | "limit-reached" | "requester-inactive"> {
    const result = await this.db
      .prepare(ISSUE_KEY_SQL)
      .bind(
        key.id,
        key.documentId,
        key.keyHash,
        key.permission,
        key.label,
        key.createdAt,
        key.expiresAt,
        maxKeys,
        requesterId,
      )
      .run();
    logQueryCost("keys.issue", [result]);

    if (result.meta.changes === 1) {
      return "issued";
    }
    return (await this.isActive(requesterId, key.documentId, key.createdAt))
      ? "limit-reached"
      : "requester-inactive";
  }

  async setExpiry(change: {
    documentId: string;
    targetId: string;
    expiresAt: string | null;
    requesterId: string;
    now: Date;
  }): Promise<"updated" | "target-revoked" | "requester-inactive"> {
    const now = change.now.toISOString();
    const result = await this.db
      .prepare(SET_EXPIRY_SQL)
      .bind(change.expiresAt, change.targetId, change.documentId, change.requesterId, now)
      .run();
    logQueryCost("keys.setExpiry", [result]);

    if (result.meta.changes === 1) {
      return "updated";
    }
    // The route already checked the target exists, isn't revoked and isn't a manager key
    // being given a date, so nothing changed because of a race: find out which.
    return (await this.isActive(change.requesterId, change.documentId, now))
      ? "target-revoked"
      : "requester-inactive";
  }

  async revoke(revocation: {
    documentId: string;
    targetId: string;
    requesterId: string;
    now: Date;
  }): Promise<"revoked" | "requester-inactive"> {
    const result = await this.db
      .prepare(REVOKE_KEY_SQL)
      .bind(
        revocation.now.toISOString(),
        revocation.targetId,
        revocation.documentId,
        revocation.requesterId,
      )
      .run();
    logQueryCost("keys.revoke", [result]);

    // The route already checked the target exists and isn't the requester, so nothing changed
    // only if the requester was revoked meanwhile.
    return result.meta.changes === 1 ? "revoked" : "requester-inactive";
  }

  async touch(keyId: string, now: Date): Promise<void> {
    const result = await this.db
      .prepare(TOUCH_KEY_SQL)
      .bind(keyId, now.toISOString(), lastUsedCutoff(now))
      .run();
    logQueryCost("keys.touch", [result]);
  }

  private async isActive(requesterId: string, documentId: string, now: string): Promise<boolean> {
    const result = await this.db
      .prepare(REQUESTER_IS_ACTIVE_SQL)
      .bind(requesterId, documentId, now)
      .run<{ active: number }>();
    logQueryCost("keys.isActive", [result]);
    return result.results[0]?.active === 1;
  }
}
