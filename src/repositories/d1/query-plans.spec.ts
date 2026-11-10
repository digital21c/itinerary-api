import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { FIND_ACTIVE_CREATOR_KEY_SQL } from "./creator-keys";
import {
  APPEND_VERSION_SQL,
  FIND_VERSION_SQL,
  HISTORY_SQL,
  INSERT_DELETION_MARKER_SQL,
  LATEST_HEAD_SQL,
  LATEST_WITH_BODY_SQL,
  PRUNE_VERSIONS_SQL,
  UNPUBLISH_DELETED_SQL,
} from "./documents";
import {
  FIND_WITH_TARGET_SQL,
  ISSUE_KEY_SQL,
  LIST_KEYS_SQL,
  REQUESTER_IS_ACTIVE_SQL,
  REVOKE_KEY_SQL,
  SET_EXPIRY_SQL,
  TOUCH_KEY_SQL,
} from "./keys";
import { FIND_PUBLISHED_SQL, PUBLISH_SQL, UNPUBLISH_SQL } from "./publications";

/**
 * D1 bills rows read, so every frequent query must search an index rather than scan a table.
 * `SEARCH … USING …` reads only matching rows; a plain `SCAN` reads every row.
 */
async function queryPlan(sql: string, parameterCount: number): Promise<string[]> {
  const parameters = Array.from({ length: parameterCount }, () => null);
  const { results } = await env.DB.prepare(`explain query plan ${sql}`)
    .bind(...parameters)
    .all<{ detail: string }>();
  return results.map((row) => row.detail);
}

/**
 * Inserting a document key makes SQLite plan scans of the tables whose foreign keys point at
 * document_keys (document_versions.created_by, document_publications.published_by), which
 * aren't indexed on purpose. Those steps only run while foreign-key violations are pending,
 * which never happens with immediate constraints; keys.spec.ts measures rows_read to prove it.
 */
const FOREIGN_KEY_CHECKS_ON_KEY_INSERT = ["SCAN document_publications", "SCAN document_versions"];

describe("query plans", () => {
  it.each([
    ["finding an active creator key", FIND_ACTIVE_CREATOR_KEY_SQL, 2, []],
    ["finding the latest version with its body", LATEST_WITH_BODY_SQL, 3, []],
    ["finding the latest version's head", LATEST_HEAD_SQL, 3, []],
    ["appending a version", APPEND_VERSION_SQL, 6, []],
    ["pruning versions", PRUNE_VERSIONS_SQL, 2, []],
    ["listing the history", HISTORY_SQL, 1, []],
    ["finding one version", FIND_VERSION_SQL, 4, []],
    ["inserting a deletion marker", INSERT_DELETION_MARKER_SQL, 5, []],
    ["unpublishing a deleted document", UNPUBLISH_DELETED_SQL, 2, []],
    ["finding the published version", FIND_PUBLISHED_SQL, 3, []],
    ["publishing a version", PUBLISH_SQL, 4, []],
    ["unpublishing", UNPUBLISH_SQL, 1, []],
    ["listing a document's keys", LIST_KEYS_SQL, 1, []],
    ["finding a requester and its target key", FIND_WITH_TARGET_SQL, 4, []],
    ["issuing a key", ISSUE_KEY_SQL, 9, FOREIGN_KEY_CHECKS_ON_KEY_INSERT],
    ["changing a key's expiry", SET_EXPIRY_SQL, 5, []],
    ["revoking a key", REVOKE_KEY_SQL, 4, []],
    ["checking a requester is active", REQUESTER_IS_ACTIVE_SQL, 3, []],
    ["recording that a key was used", TOUCH_KEY_SQL, 3, []],
  ])("%s never scans a table", async (_description, sql, parameterCount, allowedScans) => {
    const plan = await queryPlan(sql, parameterCount);

    // `SCAN CONSTANT ROW` is a select with no table (the values to insert), so it reads nothing.
    const tableScans = plan.filter(
      (step) =>
        step.startsWith("SCAN") && step !== "SCAN CONSTANT ROW" && !allowedScans.includes(step),
    );
    expect(plan.length).toBeGreaterThan(0);
    expect(tableScans).toEqual([]);
  });
});
