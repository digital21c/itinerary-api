import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { FIND_ACTIVE_CREATOR_KEY_SQL } from "./creator-keys";
import {
  APPEND_VERSION_SQL,
  LATEST_HEAD_SQL,
  LATEST_WITH_BODY_SQL,
  PRUNE_VERSIONS_SQL,
} from "./documents";
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

describe("query plans", () => {
  it.each([
    ["finding an active creator key", FIND_ACTIVE_CREATOR_KEY_SQL, 2],
    ["finding the latest version with its body", LATEST_WITH_BODY_SQL, 3],
    ["finding the latest version's head", LATEST_HEAD_SQL, 3],
    ["appending a version", APPEND_VERSION_SQL, 6],
    ["pruning versions", PRUNE_VERSIONS_SQL, 2],
    ["finding the published version", FIND_PUBLISHED_SQL, 3],
    ["publishing a version", PUBLISH_SQL, 4],
    ["unpublishing", UNPUBLISH_SQL, 1],
  ])("%s never scans a table", async (_description, sql, parameterCount) => {
    const plan = await queryPlan(sql, parameterCount);

    // `SCAN CONSTANT ROW` is a select with no table (the values to insert), so it reads nothing.
    const tableScans = plan.filter(
      (step) => step.startsWith("SCAN") && step !== "SCAN CONSTANT ROW",
    );
    expect(plan.length).toBeGreaterThan(0);
    expect(tableScans).toEqual([]);
  });
});
