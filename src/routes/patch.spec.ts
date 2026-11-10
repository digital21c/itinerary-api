import { describe, expect, it } from "vitest";
import { MAX_DOCUMENT_BYTES } from "../models/limits";
import {
  authenticationFailures,
  createDocument,
  getLatest,
  jsonObjectOfSize,
  patchDocument,
  saveVersion,
  saveVersions,
  storedVersions,
} from "./test-fixtures";

describe("PATCH /v1/documents/{id}", () => {
  it("applies a merge patch to the latest version and stores the result as a new version", async () => {
    const trip = await createDocument({
      body: { title: "Kyoto", days: [{ city: "Kyoto" }], notes: "draft", meta: { a: 1, b: 2 } },
    });

    const response = await patchDocument(trip.id, trip.editorKey, '"1"', {
      title: "Kyoto and Osaka",
      days: [{ city: "Kyoto" }, { city: "Osaka" }],
      notes: null,
      meta: { b: null, c: 3 },
      added: true,
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("Location")).toBe(`/v1/documents/${trip.id}/versions/2`);
    expect(response.headers.get("ETag")).toBe('"2"');
    expect(await (await getLatest(trip.id, trip.editorKey)).json()).toEqual({
      title: "Kyoto and Osaka",
      days: [{ city: "Kyoto" }, { city: "Osaka" }],
      meta: { a: 1, c: 3 },
      added: true,
    });
  });

  it("accepts application/json as well as merge-patch, and refuses other media types", async () => {
    const trip = await createDocument();

    expect(
      (await patchDocument(trip.id, trip.editorKey, '"1"', { a: 1 }, "application/json")).status,
    ).toBe(201);
    expect(
      (await patchDocument(trip.id, trip.editorKey, '"2"', { a: 1 }, "text/plain")).status,
    ).toBe(415);
  });

  it.each([
    ["an array", [1]],
    ["a JSON string", '"replace everything"'],
    ["null", null],
  ])("refuses a patch that is %s with 422", async (_description, patch) => {
    const trip = await createDocument();

    expect((await patchDocument(trip.id, trip.editorKey, '"1"', patch)).status).toBe(422);
    expect(await storedVersions(trip.id)).toEqual([1]);
  });

  it("refuses a patch whose result would be over the size limit with 422", async () => {
    const half = JSON.parse(jsonObjectOfSize(MAX_DOCUMENT_BYTES / 2 + 100)) as { padding: string };
    const trip = await createDocument({ body: { first: half.padding } });

    const response = await patchDocument(trip.id, trip.editorKey, '"1"', { second: half.padding });

    expect(response.status).toBe(422);
    expect(await storedVersions(trip.id)).toEqual([1]);
  });

  it.each([
    ["no If-Match", null, 428],
    ["a malformed If-Match", "*", 400],
  ])("refuses a patch with %s", async (_description, ifMatch, status) => {
    const trip = await createDocument();

    expect((await patchDocument(trip.id, trip.editorKey, ifMatch, { a: 1 })).status).toBe(status);
  });

  it("refuses a patch over a version that is no longer the latest with 412", async () => {
    const trip = await createDocument();
    await saveVersions(trip, 1);

    expect((await patchDocument(trip.id, trip.editorKey, '"1"', { a: 1 })).status).toBe(412);
    expect(await storedVersions(trip.id)).toEqual([1, 2]);
  });

  it("checks If-Match before reading the patch", async () => {
    const trip = await createDocument();
    await saveVersions(trip, 1);

    expect((await patchDocument(trip.id, trip.editorKey, '"1"', "not json")).status).toBe(412);
  });

  it("refuses a reader key with 403", async () => {
    const trip = await createDocument();

    expect((await patchDocument(trip.id, trip.readerKey, '"1"', { a: 1 })).status).toBe(403);
  });

  it("gives every authentication failure 401", async () => {
    const [trip, other] = [await createDocument(), await createDocument()];

    for (const [description, documentId, key] of await authenticationFailures(trip, other)) {
      const response =
        key === null
          ? await saveVersion(documentId, "", '"1"')
          : await patchDocument(documentId, key, '"1"', { a: 1 });
      expect.soft(response.status, description).toBe(401);
    }
    expect(await storedVersions(trip.id)).toEqual([1]);
  });

  it("patches a document at the size limit within the free plan's 10 ms of CPU", async () => {
    // Parsing the stored body, applying the patch and serialising the result is the heaviest
    // CPU work in the API. Wall time here includes D1, so this measures the pure part only,
    // repeated to smooth out noise.
    const { applyMergePatch } = await import("../models/merge-patch");
    const stored = jsonObjectOfSize(MAX_DOCUMENT_BYTES - 100);
    const patch = { added: "x", padding: null };

    const runs = 20;
    const start = performance.now();
    for (let run = 0; run < runs; run++) {
      JSON.stringify(applyMergePatch(JSON.parse(stored), patch));
    }
    const perPatch = (performance.now() - start) / runs;

    expect(perPatch).toBeLessThan(10);
  });
});
