import { describe, expect, it } from "vitest";
import { MAX_VERSIONS } from "../models/limits";
import {
  authenticationFailures,
  createDocument,
  deleteDocument,
  getHistory,
  getVersion,
  historyOf,
  keyIdOf,
  publish,
  saveVersion,
  saveVersions,
} from "./test-fixtures";

describe("GET /v1/documents/{id}/versions", () => {
  it("lists the retained versions newest first, without bodies", async () => {
    const trip = await createDocument();
    await saveVersions(trip, 2);
    await publish(trip.id, trip.editorKey, 2);

    const response = await getHistory(trip.id, trip.managerKey);
    const history = await response.json<{ versions: Record<string, unknown>[] }>();

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(history).toMatchObject({ latest: 3, oldestAvailable: 1, published: 2 });
    expect(history.versions.map((entry) => entry.version)).toEqual([3, 2, 1]);
    expect(Object.keys(history.versions[0] ?? {}).sort()).toEqual([
      "createdAt",
      "createdBy",
      "deleted",
      "version",
    ]);
  });

  it("says which key saved each version, and null for version 1", async () => {
    const trip = await createDocument();
    await saveVersion(trip.id, trip.managerKey, '"1"');

    const { versions } = await historyOf(trip.id, trip.editorKey);

    expect(versions.map((entry) => entry.createdBy)).toEqual([
      await keyIdOf(trip.managerKey),
      null,
    ]);
  });

  it("shows the pruned history, with an old published version still listed", async () => {
    const trip = await createDocument();
    await publish(trip.id, trip.editorKey, 1);
    await saveVersions(trip, MAX_VERSIONS + 2);

    const history = await historyOf(trip.id, trip.editorKey);

    expect(history).toMatchObject({ latest: 13, oldestAvailable: 1, published: 1 });
    expect(history.versions.map((entry) => entry.version)).toEqual([
      13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 1,
    ]);
  });

  it("says when nothing is published", async () => {
    const trip = await createDocument();

    expect((await historyOf(trip.id, trip.editorKey)).published).toBeNull();
  });

  it("stays readable while the document is deleted", async () => {
    const trip = await createDocument();
    await deleteDocument(trip.id, trip.editorKey, '"1"');

    const history = await historyOf(trip.id, trip.editorKey);

    expect(history.latest).toBe(2);
    expect(history.versions[0]?.deleted).toBe(true);
  });

  it("refuses a reader key with 403", async () => {
    const trip = await createDocument();

    expect((await getHistory(trip.id, trip.readerKey)).status).toBe(403);
  });

  it("gives every authentication failure 401", async () => {
    const [trip, other] = [await createDocument(), await createDocument()];

    for (const [description, documentId, key] of await authenticationFailures(trip, other)) {
      expect.soft((await getHistory(documentId, key)).status, description).toBe(401);
    }
  });
});

describe("GET /v1/documents/{id}/versions/{version}", () => {
  it("returns a version exactly as stored, cacheable for good", async () => {
    const trip = await createDocument({ body: { title: "One" } });
    await saveVersion(trip.id, trip.editorKey, '"1"', '{"title":"Two"}');

    const response = await getVersion(trip.id, trip.editorKey, 1);

    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBe('"1"');
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
    expect(await response.text()).toBe('{"title":"One"}');
  });

  it("answers 304 when If-None-Match names it", async () => {
    const trip = await createDocument();

    const response = await getVersion(trip.id, trip.editorKey, 1, { "If-None-Match": '"1"' });

    expect(response.status).toBe(304);
  });

  it("answers 410 for a pruned version", async () => {
    const trip = await createDocument();
    await saveVersions(trip, MAX_VERSIONS);

    expect((await getVersion(trip.id, trip.editorKey, 1)).status).toBe(410);
  });

  it("answers 410 for a deletion marker, and keeps older versions readable", async () => {
    const trip = await createDocument();
    await deleteDocument(trip.id, trip.editorKey, '"1"');

    expect((await getVersion(trip.id, trip.editorKey, 2)).status).toBe(410);
    expect((await getVersion(trip.id, trip.editorKey, 1)).status).toBe(200);
  });

  it.each([
    ["above the latest", 2],
    ["far above the latest", 999_999],
    ["zero", 0],
    ["not a number", "latest"],
    ["with a leading zero", "01"],
  ])("answers 404 for a version number %s", async (_description, version) => {
    const trip = await createDocument();

    expect((await getVersion(trip.id, trip.editorKey, version)).status).toBe(404);
  });

  it("refuses a reader key with 403, even for the published version", async () => {
    const trip = await createDocument();
    await publish(trip.id, trip.editorKey, 1);

    expect((await getVersion(trip.id, trip.readerKey, 1)).status).toBe(403);
  });

  it("gives every authentication failure 401", async () => {
    const [trip, other] = [await createDocument(), await createDocument()];

    for (const [description, documentId, key] of await authenticationFailures(trip, other)) {
      expect.soft((await getVersion(documentId, key, 1)).status, description).toBe(401);
    }
  });
});
