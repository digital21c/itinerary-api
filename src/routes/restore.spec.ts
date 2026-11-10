import { describe, expect, it } from "vitest";
import {
  authenticationFailures,
  createDocument,
  deleteDocument,
  getLatest,
  getPublished,
  getVersion,
  historyOf,
  issued,
  issueKey,
  keyIdOf,
  patchDocument,
  publish,
  revokeKey,
  saveVersion,
  saveVersions,
  storedVersions,
} from "./test-fixtures";

describe("DELETE /v1/documents/{id}", () => {
  it("stores a deletion marker, answers with its tag, and cuts readers off at once", async () => {
    const trip = await createDocument();
    await publish(trip.id, trip.editorKey, 1);
    expect((await getPublished(trip.id, trip.readerKey)).status).toBe(200);

    const response = await deleteDocument(trip.id, trip.editorKey, '"1"');

    expect(response.status).toBe(204);
    expect(response.headers.get("ETag")).toBe('"2"');
    expect((await getPublished(trip.id, trip.readerKey)).status).toBe(404);
    expect((await getLatest(trip.id, trip.editorKey)).status).toBe(410);
    expect((await historyOf(trip.id, trip.editorKey)).versions[0]).toMatchObject({
      version: 2,
      deleted: true,
    });
  });

  it("refuses a deleted document's writes until it is restored", async () => {
    const trip = await createDocument();
    await deleteDocument(trip.id, trip.editorKey, '"1"');

    expect((await deleteDocument(trip.id, trip.editorKey, '"2"')).status).toBe(410);
    expect((await publish(trip.id, trip.editorKey, 1)).status).toBe(410);
    expect((await patchDocument(trip.id, trip.editorKey, '"2"', { a: 1 })).status).toBe(410);
    expect(
      (await issueKey(trip.id, trip.managerKey, { permission: "reader", label: "x" })).status,
    ).toBe(410);
  });

  it.each([
    ["no If-Match", null, 428],
    ["a malformed If-Match", "1", 400],
    ["version 0 in If-Match", '"0"', 400],
  ])("refuses a delete with %s", async (_description, ifMatch, status) => {
    const trip = await createDocument();

    expect((await deleteDocument(trip.id, trip.editorKey, ifMatch)).status).toBe(status);
    expect(await storedVersions(trip.id)).toEqual([1]);
  });

  it("refuses a delete over a version someone has since replaced with 412, and keeps it published", async () => {
    const trip = await createDocument();
    await publish(trip.id, trip.editorKey, 1);
    await saveVersions(trip, 1);

    const response = await deleteDocument(trip.id, trip.managerKey, '"1"');

    expect(response.status).toBe(412);
    expect(await storedVersions(trip.id)).toEqual([1, 2]);
    expect((await getPublished(trip.id, trip.readerKey)).status).toBe(200);
  });

  it("refuses a reader key with 403", async () => {
    const trip = await createDocument();

    expect((await deleteDocument(trip.id, trip.readerKey, '"1"')).status).toBe(403);
    expect(await storedVersions(trip.id)).toEqual([1]);
  });

  it("gives every authentication failure 401", async () => {
    const [trip, other] = [await createDocument(), await createDocument()];

    for (const [description, documentId, key] of await authenticationFailures(trip, other)) {
      expect.soft((await deleteDocument(documentId, key, '"1"')).status, description).toBe(401);
    }
    expect(await storedVersions(trip.id)).toEqual([1]);
  });
});

describe("restoring a deleted document", () => {
  it("restores an earlier version, unpublished, until someone publishes again", async () => {
    const trip = await createDocument({ body: { title: "Original" } });
    await saveVersion(trip.id, trip.editorKey, '"1"', '{"title":"Good"}');
    await publish(trip.id, trip.editorKey, 2);
    const deleted = await deleteDocument(trip.id, trip.editorKey, '"2"');
    const marker = deleted.headers.get("ETag") ?? "";

    // While deleted, the history and the old versions stay readable to editors.
    const good = await getVersion(trip.id, trip.editorKey, 2);
    const response = await saveVersion(trip.id, trip.editorKey, marker, await good.text());

    expect(response.status).toBe(201);
    expect(response.headers.get("ETag")).toBe('"4"');
    const latest = await getLatest(trip.id, trip.editorKey);
    expect(await latest.json()).toEqual({ title: "Good" });
    expect((await getPublished(trip.id, trip.readerKey)).status).toBe(404);

    expect((await publish(trip.id, trip.editorKey, 4)).status).toBe(204);
    expect(await (await getPublished(trip.id, trip.readerKey)).json()).toEqual({ title: "Good" });
  });

  it("is a normal document again afterwards", async () => {
    const trip = await createDocument();
    await deleteDocument(trip.id, trip.editorKey, '"1"');
    await saveVersion(trip.id, trip.editorKey, '"2"');

    expect((await saveVersion(trip.id, trip.editorKey, '"3"')).status).toBe(201);
    expect((await patchDocument(trip.id, trip.editorKey, '"4"', { a: 1 })).status).toBe(201);
    expect(
      (await issueKey(trip.id, trip.managerKey, { permission: "reader", label: "x" })).status,
    ).toBe(201);
  });

  it("lets exactly one of two simultaneous restores win", async () => {
    const trip = await createDocument();
    await deleteDocument(trip.id, trip.editorKey, '"1"');

    const responses = await Promise.all([
      saveVersion(trip.id, trip.editorKey, '"2"', '{"by":"editor"}'),
      saveVersion(trip.id, trip.managerKey, '"2"', '{"by":"manager"}'),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 412]);
    expect(await storedVersions(trip.id)).toEqual([1, 2, 3]);
  });

  it("keeps keys revoked while the document was deleted revoked", async () => {
    const trip = await createDocument();
    const editor = await issued(trip.id, trip.managerKey, { permission: "editor" });
    await deleteDocument(trip.id, trip.editorKey, '"1"');
    await revokeKey(trip.id, trip.managerKey, editor.id);

    await saveVersion(trip.id, trip.editorKey, '"2"');

    expect((await getLatest(trip.id, editor.key)).status).toBe(401);
    expect((await getLatest(trip.id, trip.editorKey)).status).toBe(200);
  });

  it("can't be done by a reader key", async () => {
    const trip = await createDocument();
    await deleteDocument(trip.id, trip.editorKey, '"1"');

    expect((await saveVersion(trip.id, trip.readerKey, '"2"')).status).toBe(403);
    expect(await storedVersions(trip.id)).toEqual([1, 2]);
  });

  it("records which key restored it", async () => {
    const trip = await createDocument();
    await deleteDocument(trip.id, trip.editorKey, '"1"');
    await saveVersion(trip.id, trip.managerKey, '"2"');

    const history = await historyOf(trip.id, trip.editorKey);

    expect(history.versions[0]?.createdBy).toBe(await keyIdOf(trip.managerKey));
    expect(history.versions[1]?.createdBy).toBe(await keyIdOf(trip.editorKey));
  });
});
