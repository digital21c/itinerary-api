import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { generateKey, hashKey } from "../auth/keys";
import { createDocument, insertCreatorKey, request } from "./test-fixtures";

function checkCreatorKey(key: string | null): Promise<Response> {
  return request("/v1/creator-key", {
    headers: key === null ? {} : { Authorization: `Bearer ${key}` },
  });
}

async function creatorKeyRow(key: string) {
  return env.DB.prepare(
    `select k.last_used_at,
            (select count(*) from documents d where d.created_by = k.id) as documents
     from creator_keys k where k.key_hash = ?1`,
  )
    .bind(await hashKey(key))
    .first();
}

describe("GET /v1/creator-key", () => {
  it("answers 204 for an active creator key, without caching", async () => {
    const { key } = await insertCreatorKey();

    const response = await checkCreatorKey(key);

    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });

  it("has no side effects: creates nothing and doesn't record the key as used", async () => {
    const { key } = await insertCreatorKey();

    await checkCreatorKey(key);

    expect(await creatorKeyRow(key)).toEqual({ last_used_at: null, documents: 0 });
  });

  it("accepts a creator key that hasn't expired yet", async () => {
    const { key } = await insertCreatorKey({ expiresAt: "2999-01-01T00:00:00.000Z" });

    expect((await checkCreatorKey(key)).status).toBe(204);
  });

  it("gives every failure the same 401, which never contains the key", async () => {
    const revoked = await insertCreatorKey({ revokedAt: "2026-01-01T00:00:00.000Z" });
    const expired = await insertCreatorKey({ expiresAt: "2026-01-01T00:00:00.000Z" });
    const trip = await createDocument();
    const baseline = await (await checkCreatorKey(null)).text();

    for (const [description, key] of [
      ["a malformed key", "ck_short"],
      ["an unknown creator key", generateKey("creator")],
      ["a revoked creator key", revoked.key],
      ["an expired creator key", expired.key],
      ["a trip's manager key", trip.managerKey],
      ["a trip's reader key", trip.readerKey],
    ] as const) {
      const response = await checkCreatorKey(key);
      const text = await response.text();

      expect.soft(response.status, description).toBe(401);
      expect.soft(response.headers.get("WWW-Authenticate"), description).toBe("Bearer");
      expect.soft(text, description).toBe(baseline);
      expect.soft(text.includes(key), description).toBe(false);
    }
  });
});
