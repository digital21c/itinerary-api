import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  createDocument,
  getLatest,
  getPublished,
  getVersion,
  publish,
  saveVersion,
} from "./test-fixtures";

/** The HTTP date a stored ISO timestamp should appear as (whole seconds, GMT). */
function httpDate(iso: string): string {
  return new Date(iso).toUTCString();
}

async function versionCreatedAt(documentId: string, version: number): Promise<string> {
  const row = await env.DB.prepare(
    "select created_at from document_versions where document_id = ?1 and version = ?2",
  )
    .bind(documentId, version)
    .first<{ created_at: string }>();
  return row?.created_at ?? "";
}

async function publishedAt(documentId: string): Promise<string> {
  const row = await env.DB.prepare(
    "select published_at from document_publications where document_id = ?1",
  )
    .bind(documentId)
    .first<{ published_at: string }>();
  return row?.published_at ?? "";
}

/** Sets the publication time back, so a later publish visibly changes (or keeps) it. */
async function backdatePublication(documentId: string): Promise<void> {
  await env.DB.prepare("update document_publications set published_at = ?1 where document_id = ?2")
    .bind("2026-01-01T00:00:00.000Z", documentId)
    .run();
}

describe("Last-Modified", () => {
  it("is when the latest version was saved", async () => {
    const trip = await createDocument();
    await saveVersion(trip.id, trip.editorKey, '"1"');

    const response = await getLatest(trip.id, trip.editorKey);

    expect(response.headers.get("Last-Modified")).toBe(
      httpDate(await versionCreatedAt(trip.id, 2)),
    );
    expect(response.headers.get("Last-Modified")).toMatch(
      /^\w{3}, \d{2} \w{3} \d{4} [\d:]{8} GMT$/,
    );
  });

  it("is when a numbered version was saved", async () => {
    const trip = await createDocument();
    await saveVersion(trip.id, trip.editorKey, '"1"');

    const response = await getVersion(trip.id, trip.editorKey, 1);

    expect(response.headers.get("Last-Modified")).toBe(
      httpDate(await versionCreatedAt(trip.id, 1)),
    );
  });

  it("is when the published version was published, for readers", async () => {
    const trip = await createDocument();
    await publish(trip.id, trip.editorKey, 1);

    const response = await getPublished(trip.id, trip.readerKey);

    expect(response.headers.get("Last-Modified")).toBe(httpDate(await publishedAt(trip.id)));
  });

  it("is also on 304, so revalidating readers learn it without the body", async () => {
    const trip = await createDocument();
    await publish(trip.id, trip.editorKey, 1);

    const response = await getPublished(trip.id, trip.readerKey, { "If-None-Match": '"1"' });

    expect(response.status).toBe(304);
    expect(response.headers.get("Last-Modified")).toBe(httpDate(await publishedAt(trip.id)));
  });

  it("doesn't change when the same version is published again", async () => {
    const trip = await createDocument();
    await publish(trip.id, trip.editorKey, 1);
    await backdatePublication(trip.id);

    expect((await publish(trip.id, trip.managerKey, 1)).status).toBe(204);

    expect(await publishedAt(trip.id)).toBe("2026-01-01T00:00:00.000Z");
    const row = await env.DB.prepare(
      `select k.permission from document_publications p join document_keys k on k.id = p.published_by
       where p.document_id = ?1`,
    )
      .bind(trip.id)
      .first();
    expect(row).toEqual({ permission: "editor" });
  });

  it("changes when another version is published", async () => {
    const trip = await createDocument();
    await saveVersion(trip.id, trip.editorKey, '"1"');
    await publish(trip.id, trip.editorKey, 1);
    await backdatePublication(trip.id);

    await publish(trip.id, trip.editorKey, 2);

    expect((await publishedAt(trip.id)) > "2026-01-01T00:00:00.000Z").toBe(true);
  });

  it("doesn't change for readers when a draft is saved", async () => {
    const trip = await createDocument();
    await publish(trip.id, trip.editorKey, 1);
    const before = (await getPublished(trip.id, trip.readerKey)).headers.get("Last-Modified");

    await new Promise((resolve) => setTimeout(resolve, 1100));
    await saveVersion(trip.id, trip.editorKey, '"1"');

    expect((await getPublished(trip.id, trip.readerKey)).headers.get("Last-Modified")).toBe(before);
  });
});
