import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { planNewDocument } from "../../models/new-document";
import { D1DocumentRepository } from "./documents";
import { D1PublicationRepository } from "./publications";

async function storedDocument() {
  const creatorKeyId = crypto.randomUUID();
  await env.DB.prepare("insert into creator_keys (id, key_hash, created_at) values (?1, ?2, ?3)")
    .bind(creatorKeyId, crypto.getRandomValues(new Uint8Array(32)), new Date().toISOString())
    .run();
  const { document } = await planNewDocument({
    body: { title: "x" },
    creatorKeyId,
    now: new Date(),
  });
  await new D1DocumentRepository(env.DB).create(document);
  const editorKeyId = document.keys.find((key) => key.permission === "editor")?.id ?? "";
  return { documentId: document.id, editorKeyId };
}

async function insertDeletionMarker(documentId: string, version: number): Promise<void> {
  await env.DB.prepare(
    `insert into document_versions (document_id, version, body, deleted, created_at)
     values (?1, ?2, null, 1, ?3)`,
  )
    .bind(documentId, version, new Date().toISOString())
    .run();
}

function publication(documentId: string, version: number, publishedBy: string) {
  return { documentId, version, publishedAt: new Date().toISOString(), publishedBy };
}

describe("D1PublicationRepository.publish", () => {
  const repository = () => new D1PublicationRepository(env.DB);

  it("publishes an existing version, and replaces an earlier publication", async () => {
    const { documentId, editorKeyId } = await storedDocument();

    expect(await repository().publish(publication(documentId, 1, editorKeyId))).toBe("published");
    expect(await repository().publish(publication(documentId, 1, editorKeyId))).toBe("published");
  });

  it("refuses a version that doesn't exist", async () => {
    const { documentId, editorKeyId } = await storedDocument();

    expect(await repository().publish(publication(documentId, 2, editorKeyId))).toBe(
      "not-publishable",
    );
  });

  // The route checks for deletion first; these are the checks in the statement itself, which
  // stop a publish that races a delete.
  it("refuses a deletion marker", async () => {
    const { documentId, editorKeyId } = await storedDocument();
    await insertDeletionMarker(documentId, 2);

    expect(await repository().publish(publication(documentId, 2, editorKeyId))).toBe(
      "not-publishable",
    );
  });

  it("refuses an old version once the document's latest version is a deletion marker", async () => {
    const { documentId, editorKeyId } = await storedDocument();
    await insertDeletionMarker(documentId, 2);

    expect(await repository().publish(publication(documentId, 1, editorKeyId))).toBe(
      "not-publishable",
    );
    const row = await env.DB.prepare("select * from document_publications where document_id = ?1")
      .bind(documentId)
      .first();
    expect(row).toBeNull();
  });
});
