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

describe("D1DocumentRepository.appendVersion", () => {
  async function storedDocument() {
    const repository = new D1DocumentRepository(env.DB);
    const document = await newDocument(await insertCreatorKeyRow(), new Date());
    await repository.create(document);
    const editorKeyId = document.keys.find((key) => key.permission === "editor")?.id ?? "";
    return { repository, document, editorKeyId };
  }

  function version(documentId: string, baseVersion: number, createdBy: string) {
    return {
      documentId,
      baseVersion,
      newVersion: baseVersion + 1,
      body: JSON.stringify({ base: baseVersion }),
      createdAt: new Date().toISOString(),
      createdBy,
    };
  }

  async function versionsOf(documentId: string): Promise<number[]> {
    const { results } = await env.DB.prepare(
      "select version from document_versions where document_id = ?1 order by version",
    )
      .bind(documentId)
      .all<{ version: number }>();
    return results.map((row) => row.version);
  }

  it("appends when the base is the latest version", async () => {
    const { repository, document, editorKeyId } = await storedDocument();

    expect(await repository.appendVersion(version(document.id, 1, editorKeyId), 10)).toBe(
      "appended",
    );
    expect(await versionsOf(document.id)).toEqual([1, 2]);
  });

  // The route checks the base first; this is the atomic check that stops a race between them.
  it("inserts nothing when the base is no longer the latest", async () => {
    const { repository, document, editorKeyId } = await storedDocument();
    await repository.appendVersion(version(document.id, 1, editorKeyId), 10);

    expect(await repository.appendVersion(version(document.id, 1, editorKeyId), 10)).toBe("stale");
    expect(await versionsOf(document.id)).toEqual([1, 2]);
  });

  it("prunes to the given number of versions", async () => {
    const { repository, document, editorKeyId } = await storedDocument();

    for (const base of [1, 2, 3]) {
      await repository.appendVersion(version(document.id, base, editorKeyId), 2);
    }

    expect(await versionsOf(document.id)).toEqual([3, 4]);
  });
});

describe("D1DocumentRepository.deleteDocument", () => {
  // The route checks the base first; these are the checks in the batch itself, which stop a
  // delete racing a save or another delete.
  async function publishedDocument() {
    const repository = new D1DocumentRepository(env.DB);
    const document = await newDocument(await insertCreatorKeyRow(), new Date());
    await repository.create(document);
    await env.DB.prepare(
      "insert into document_publications (document_id, version, published_at) values (?1, 1, ?2)",
    )
      .bind(document.id, new Date().toISOString())
      .run();
    const editorKeyId = document.keys.find((key) => key.permission === "editor")?.id ?? "";
    return { repository, documentId: document.id, editorKeyId };
  }

  async function state(documentId: string) {
    return env.DB.prepare(
      `select (select group_concat(version || ':' || deleted, ',') from
                (select version, deleted from document_versions
                 where document_id = ?1 order by version)) as versions,
              (select version from document_publications where document_id = ?1) as published`,
    )
      .bind(documentId)
      .first();
  }

  function deletion(documentId: string, baseVersion: number, createdBy: string) {
    return {
      documentId,
      baseVersion,
      markerVersion: baseVersion + 1,
      createdAt: new Date().toISOString(),
      createdBy,
    };
  }

  it("inserts the marker and unpublishes when the base is the latest", async () => {
    const { repository, documentId, editorKeyId } = await publishedDocument();

    expect(await repository.deleteDocument(deletion(documentId, 1, editorKeyId), 10)).toBe(
      "deleted",
    );
    expect(await state(documentId)).toEqual({ versions: "1:0,2:1", published: null });
  });

  it("changes nothing, and keeps the publication, when the base is no longer the latest", async () => {
    const { repository, documentId, editorKeyId } = await publishedDocument();
    await repository.appendVersion(
      {
        documentId,
        baseVersion: 1,
        newVersion: 2,
        body: "{}",
        createdAt: new Date().toISOString(),
        createdBy: editorKeyId,
      },
      10,
    );

    expect(await repository.deleteDocument(deletion(documentId, 1, editorKeyId), 10)).toBe("stale");
    expect(await state(documentId)).toEqual({ versions: "1:0,2:0", published: 1 });
  });

  it("never stacks a second marker on a deleted document", async () => {
    const { repository, documentId, editorKeyId } = await publishedDocument();
    await repository.deleteDocument(deletion(documentId, 1, editorKeyId), 10);

    expect(await repository.deleteDocument(deletion(documentId, 2, editorKeyId), 10)).toBe("stale");
    expect(await state(documentId)).toEqual({ versions: "1:0,2:1", published: null });
  });
});
