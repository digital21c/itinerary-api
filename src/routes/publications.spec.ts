import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { MAX_VERSIONS } from "../models/limits";
import {
  authenticationFailures,
  createDocument,
  getLatest,
  getPublished,
  markDeleted,
  publish,
  request,
  saveVersion,
  saveVersions,
  unpublish,
} from "./test-fixtures";

async function publishedRow(documentId: string) {
  return env.DB.prepare(
    `select p.version, k.permission as published_by
     from document_publications p left join document_keys k on k.id = p.published_by
     where p.document_id = ?1`,
  )
    .bind(documentId)
    .first();
}

describe("the traveller path", () => {
  it("shows travellers only what an editor published, never a newer draft", async () => {
    const trip = await createDocument({ body: { title: "Draft 1" } });
    const reader = trip.readerKey;

    // A new trip is unpublished.
    expect((await getPublished(trip.id, reader)).status).toBe(404);

    // Save version 2 and publish it: travellers see version 2.
    await saveVersion(trip.id, trip.editorKey, '"1"', '{"title":"Ready"}');
    expect((await publish(trip.id, trip.editorKey, 2)).status).toBe(204);
    const first = await getPublished(trip.id, reader);
    expect(first.status).toBe(200);
    expect(first.headers.get("ETag")).toBe('"2"');
    expect(await first.json()).toEqual({ title: "Ready" });

    // Save version 3: travellers still see version 2, and revalidating costs no body.
    await saveVersion(trip.id, trip.editorKey, '"2"', '{"title":"Work in progress"}');
    const stillTwo = await getPublished(trip.id, reader);
    expect(stillTwo.headers.get("ETag")).toBe('"2"');
    expect(await stillTwo.json()).toEqual({ title: "Ready" });
    expect((await getPublished(trip.id, reader, { "If-None-Match": '"2"' })).status).toBe(304);

    // Publish version 3: travellers see it.
    expect((await publish(trip.id, trip.editorKey, 3)).status).toBe(204);
    expect(await (await getPublished(trip.id, reader)).json()).toEqual({
      title: "Work in progress",
    });

    // Revert by publishing version 2 again.
    expect((await publish(trip.id, trip.managerKey, 2)).status).toBe(204);
    const reverted = await getPublished(trip.id, reader);
    expect(reverted.headers.get("ETag")).toBe('"2"');
    expect(await reverted.json()).toEqual({ title: "Ready" });
  });
});

describe("GET /v1/documents/{id}/published", () => {
  it.each(["reader", "editor", "manager"] as const)(
    "gives a %s key the published version exactly as stored",
    async (permission) => {
      const body = { title: "Kyoto", days: [{ day: 1 }] };
      const trip = await createDocument({ body });
      await publish(trip.id, trip.editorKey, 1);

      const response = await getPublished(trip.id, trip[`${permission}Key`]);

      expect(response.status).toBe(200);
      expect(response.headers.get("ETag")).toBe('"1"');
      expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
      expect(response.headers.get("Content-Type")).toBe("application/json");
      expect(await response.text()).toBe(JSON.stringify(body));
    },
  );

  it.each(["reader", "editor", "manager"] as const)(
    "gives a %s key 404 when nothing is published",
    async (permission) => {
      const trip = await createDocument();

      const response = await getPublished(trip.id, trip[`${permission}Key`]);

      expect(response.status).toBe(404);
      expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    },
  );

  it.each([
    ["the same tag", '"1"'],
    ["a weak tag", 'W/"1"'],
    ["any tag", "*"],
  ])("answers 304 when If-None-Match holds %s", async (_description, tag) => {
    const trip = await createDocument();
    await publish(trip.id, trip.editorKey, 1);

    const response = await getPublished(trip.id, trip.readerKey, { "If-None-Match": tag });

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
  });

  it("gives every authentication failure the same 401 as the other endpoints", async () => {
    const [trip, other] = [await createDocument(), await createDocument()];
    await publish(trip.id, trip.editorKey, 1);
    const baseline = await (await getLatest(trip.id, null)).text();

    for (const [description, documentId, key] of await authenticationFailures(trip, other)) {
      const response = await getPublished(documentId, key);
      const text = await response.text();

      expect.soft(response.status, description).toBe(401);
      expect.soft(response.headers.get("WWW-Authenticate"), description).toBe("Bearer");
      expect.soft(text, description).toBe(baseline);
      if (key !== null) {
        expect.soft(text.includes(key), description).toBe(false);
      }
    }
  });

  it("doesn't let a reader key of another trip read this one", async () => {
    const [trip, other] = [await createDocument(), await createDocument()];
    await publish(trip.id, trip.editorKey, 1);

    expect((await getPublished(trip.id, other.readerKey)).status).toBe(401);
  });
});

describe("PUT /v1/documents/{id}/published", () => {
  it.each(["editor", "manager"] as const)(
    "lets a %s key publish, recording which key did",
    async (permission) => {
      const trip = await createDocument();

      const response = await publish(trip.id, trip[`${permission}Key`], 1);

      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
      expect(await publishedRow(trip.id)).toEqual({ version: 1, published_by: permission });
    },
  );

  it("refuses a reader key with 403", async () => {
    const trip = await createDocument();

    const response = await publish(trip.id, trip.readerKey, 1);

    expect(response.status).toBe(403);
    expect(await publishedRow(trip.id)).toBeNull();
  });

  it("gives every authentication failure the same 401", async () => {
    const [trip, other] = [await createDocument(), await createDocument()];
    const baseline = await (await getLatest(trip.id, null)).text();

    for (const [description, documentId, key] of await authenticationFailures(trip, other)) {
      const response =
        key === null
          ? await request(`/v1/documents/${documentId}/published`, {
              method: "PUT",
              body: '{"version":1}',
              headers: { "Content-Type": "application/json" },
            })
          : await publish(documentId, key, 1);

      expect.soft(response.status, description).toBe(401);
      expect.soft(await response.text(), description).toBe(baseline);
    }
  });

  it("is idempotent: publishing the same version again succeeds", async () => {
    const trip = await createDocument();

    expect((await publish(trip.id, trip.editorKey, 1)).status).toBe(204);
    expect((await publish(trip.id, trip.editorKey, 1)).status).toBe(204);
    expect(await publishedRow(trip.id)).toEqual({ version: 1, published_by: "editor" });
  });

  it("needs no If-Match", async () => {
    const trip = await createDocument();
    await saveVersions(trip, 2);

    expect((await publish(trip.id, trip.editorKey, 2)).status).toBe(204);
  });

  it.each([
    ["a version that doesn't exist yet", 5],
    ["a version number far beyond the history", 999_999],
  ])("refuses %s with 422", async (_description, version) => {
    const trip = await createDocument();

    const response = await publish(trip.id, trip.editorKey, version);

    expect(response.status).toBe(422);
    expect(await publishedRow(trip.id)).toBeNull();
  });

  it("refuses a pruned version with 422", async () => {
    const trip = await createDocument();
    await saveVersions(trip, MAX_VERSIONS);

    const response = await publish(trip.id, trip.editorKey, 1);

    expect(response.status).toBe(422);
  });

  it("refuses to publish on a deleted document with 410, keeping it unreadable", async () => {
    const trip = await createDocument();
    await markDeleted(trip.id, 2);

    const response = await publish(trip.id, trip.editorKey, 1);

    expect(response.status).toBe(410);
    expect((await getPublished(trip.id, trip.readerKey)).status).toBe(404);
  });

  it.each([
    ["text/plain", '{"version":1}', { "Content-Type": "text/plain" }, 415],
    ["a body over 1,000 bytes", JSON.stringify({ version: 1, x: "y".repeat(1000) }), {}, 413],
    ["invalid JSON", "{", {}, 400],
    ["no version", "{}", {}, 422],
    ["version 0", '{"version":0}', {}, 422],
    ["a version as text", '{"version":"1"}', {}, 422],
    ["a fractional version", '{"version":1.5}', {}, 422],
    ["an extra field", '{"version":1,"when":"now"}', {}, 422],
    ["an array", "[1]", {}, 422],
  ])("checks the body: %s", async (_description, body, headers, status) => {
    const trip = await createDocument();

    const response = await publish(trip.id, trip.editorKey, 1, body, headers);

    expect(response.status).toBe(status);
    expect(await publishedRow(trip.id)).toBeNull();
  });
});

describe("DELETE /v1/documents/{id}/published", () => {
  it("unpublishes, so readers get 404, and is safe to repeat", async () => {
    const trip = await createDocument();
    await publish(trip.id, trip.editorKey, 1);

    expect((await unpublish(trip.id, trip.editorKey)).status).toBe(204);
    expect((await getPublished(trip.id, trip.readerKey)).status).toBe(404);
    expect((await unpublish(trip.id, trip.managerKey)).status).toBe(204);
  });

  it("unpublishes only its own trip", async () => {
    const [trip, other] = [await createDocument(), await createDocument()];
    await publish(trip.id, trip.editorKey, 1);
    await publish(other.id, other.editorKey, 1);

    await unpublish(trip.id, trip.editorKey);

    expect((await getPublished(other.id, other.readerKey)).status).toBe(200);
  });

  it("answers 204 when nothing was published", async () => {
    const trip = await createDocument();

    expect((await unpublish(trip.id, trip.editorKey)).status).toBe(204);
  });

  it("refuses a reader key with 403, leaving the publication", async () => {
    const trip = await createDocument();
    await publish(trip.id, trip.editorKey, 1);

    expect((await unpublish(trip.id, trip.readerKey)).status).toBe(403);
    expect((await getPublished(trip.id, trip.readerKey)).status).toBe(200);
  });

  it("refuses another trip's editor key with 401", async () => {
    const [trip, other] = [await createDocument(), await createDocument()];
    await publish(trip.id, trip.editorKey, 1);

    expect((await unpublish(trip.id, other.editorKey)).status).toBe(401);
    expect((await getPublished(trip.id, trip.readerKey)).status).toBe(200);
  });
});
