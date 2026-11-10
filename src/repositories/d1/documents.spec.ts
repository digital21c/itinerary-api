import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { planNewDocument } from "../../models/new-document";
import { D1DocumentRepository } from "./documents";

async function insertCreatorKeyRow(): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare("insert into creator_keys (id, key_hash, created_at) values (?1, ?2, ?3)")
    .bind(id, crypto.getRandomValues(new Uint8Array(32)), new Date().toISOString())
    .run();
  return id;
}

async function newDocument(creatorKeyId: string, now: Date) {
  const { document } = await planNewDocument({ body: { title: "x" }, creatorKeyId, now });
  return document;
}

describe("D1DocumentRepository.create", () => {
  it("writes nothing at all if any statement in the batch fails", async () => {
    const repository = new D1DocumentRepository(env.DB);
    const creatorKeyId = await insertCreatorKeyRow();
    const first = await newDocument(creatorKeyId, new Date("2026-11-10T10:00:00.000Z"));
    await repository.create(first);

    // Reusing one of the first document's key hashes breaks the unique constraint on
    // key_hash, in the fifth of the batch's six statements.
    const second = await newDocument(creatorKeyId, new Date("2026-11-10T11:00:00.000Z"));
    const firstKey = first.keys[0];
    const secondKey = second.keys[2];
    if (firstKey === undefined || secondKey === undefined) {
      throw new Error("A new document has three keys.");
    }
    const clashing = {
      ...second,
      keys: [...second.keys.slice(0, 2), { ...secondKey, keyHash: firstKey.keyHash }],
    };

    await expect(repository.create(clashing)).rejects.toThrow(/UNIQUE/);

    const left = await env.DB.prepare(
      `select (select count(*) from documents where id = ?1) as documents,
              (select count(*) from document_versions where document_id = ?1) as versions,
              (select count(*) from document_keys where document_id = ?1) as keys,
              (select last_used_at from creator_keys where id = ?2) as last_used_at`,
    )
      .bind(second.id, creatorKeyId)
      .first();
    expect(left).toEqual({
      documents: 0,
      versions: 0,
      keys: 0,
      last_used_at: "2026-11-10T10:00:00.000Z",
    });
  });
});
