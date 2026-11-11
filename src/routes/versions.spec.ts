import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { MAX_DOCUMENT_BYTES, MAX_VERSIONS } from "../models/limits";
import {
  authenticationFailures,
  createDocument,
  getLatest,
  jsonObjectOfSize,
  markDeleted,
  publish,
  request,
  saveVersion,
  saveVersions,
  storedVersions,
} from "./test-fixtures";

describe("GET /v1/documents/{id}", () => {
  it.each(["editor", "manager"] as const)(
    "gives a %s key the latest version exactly as stored",
    async (permission) => {
      const body = { title: "Kyoto", days: [{ day: 1 }] };
      const document = await createDocument({ body });

      const response = await getLatest(document.id, document[`${permission}Key`]);

      expect(response.status).toBe(200);
      expect(response.headers.get("ETag")).toBe('"1"');
      expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
      expect(response.headers.get("Content-Type")).toBe("application/json");
      expect(await response.text()).toBe(JSON.stringify(body));
    },
  );

  it("refuses a reader key with 403", async () => {
    const document = await createDocument();

    const response = await getLatest(document.id, document.readerKey);

    expect(response.status).toBe(403);
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
  });

  it("gives every authentication failure the same 401, never echoing the key", async () => {
    const [document, other] = [await createDocument(), await createDocument()];
    const baseline = await (await getLatest(document.id, null)).text();

    for (const [description, documentId, key] of await authenticationFailures(document, other)) {
      const response = await getLatest(documentId, key);
      const text = await response.text();

      expect.soft(response.status, description).toBe(401);
      expect.soft(response.headers.get("WWW-Authenticate"), description).toBe("Bearer");
      expect.soft(text, description).toBe(baseline);
      if (key !== null) {
        expect.soft(text.includes(key), description).toBe(false);
      }
    }
  });

  it.each([
    ["the same tag", '"1"'],
    ["a weak tag", 'W/"1"'],
    ["any tag", "*"],
    ["a list containing it", '"7", "1"'],
  ])("answers 304 with no body when If-None-Match holds %s", async (_description, tag) => {
    const document = await createDocument();

    const response = await getLatest(document.id, document.editorKey, { "If-None-Match": tag });

    expect(response.status).toBe(304);
    expect(response.headers.get("ETag")).toBe('"1"');
    expect(await response.text()).toBe("");
  });

  it("sends the document when If-None-Match holds an older version", async () => {
    const document = await createDocument();
    await saveVersions(document, 1);

    const response = await getLatest(document.id, document.editorKey, { "If-None-Match": '"1"' });

    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBe('"2"');
  });

  it("answers 410 once the document is deleted, and still 403 to a reader", async () => {
    const document = await createDocument();
    await markDeleted(document.id, 2);

    expect((await getLatest(document.id, document.editorKey)).status).toBe(410);
    expect((await getLatest(document.id, document.managerKey)).status).toBe(410);
    expect((await getLatest(document.id, document.readerKey)).status).toBe(403);
  });
});

describe("POST /v1/documents/{id}/versions", () => {
  it("saves the next version, which then reads as the latest", async () => {
    const document = await createDocument();

    const response = await saveVersion(document.id, document.editorKey, '"1"', '{"title":"Two"}');

    expect(response.status).toBe(201);
    expect(response.headers.get("Location")).toBe(`/v1/documents/${document.id}/versions/2`);
    expect(response.headers.get("ETag")).toBe('"2"');
    expect(await response.text()).toBe("");

    const latest = await getLatest(document.id, document.editorKey);
    expect(latest.headers.get("ETag")).toBe('"2"');
    expect(await latest.json()).toEqual({ title: "Two" });
  });

  it("records which key saved the version", async () => {
    const document = await createDocument();
    await saveVersion(document.id, document.managerKey, '"1"');

    const row = await env.DB.prepare(
      `select k.permission from document_versions v
       join document_keys k on k.id = v.created_by
       where v.document_id = ?1 and v.version = 2`,
    )
      .bind(document.id)
      .first();
    expect(row).toEqual({ permission: "manager" });
  });

  it("refuses a save without If-Match with 428", async () => {
    const document = await createDocument();

    const response = await saveVersion(document.id, document.editorKey, null);

    expect(response.status).toBe(428);
  });

  it.each([
    ["an unquoted version", "1"],
    ["any version", "*"],
    ["a list", '"1", "2"'],
    ["version 0", '"0"'],
    ["a leading zero", '"01"'],
    ["a non-number", '"abc"'],
    ["an empty tag", '""'],
  ])("refuses If-Match with %s with 400", async (_description, ifMatch) => {
    const document = await createDocument();

    const response = await saveVersion(document.id, document.editorKey, ifMatch);

    expect(response.status).toBe(400);
  });

  it("refuses a save over a version that is no longer the latest with 412", async () => {
    const document = await createDocument();
    expect((await saveVersion(document.id, document.editorKey, '"1"')).status).toBe(201);

    const stale = await saveVersion(document.id, document.managerKey, '"1"');

    expect(stale.status).toBe(412);
    expect(await storedVersions(document.id)).toEqual([1, 2]);
  });

  it("accepts a weak tag in If-Match as the same version, as the edge sends after compressing", async () => {
    const document = await createDocument();

    const response = await saveVersion(document.id, document.editorKey, 'W/"1"');
    const stale = await saveVersion(document.id, document.managerKey, 'W/"1"');

    expect(response.status).toBe(201);
    expect(response.headers.get("ETag")).toBe('"2"');
    expect(stale.status).toBe(412);
    expect(await storedVersions(document.id)).toEqual([1, 2]);
  });

  it("refuses a save over a version that doesn't exist yet with 412", async () => {
    const document = await createDocument();

    const response = await saveVersion(document.id, document.editorKey, '"5"');

    expect(response.status).toBe(412);
  });

  it("lets exactly one of two simultaneous saves on the same version win", async () => {
    const document = await createDocument();

    const responses = await Promise.all([
      saveVersion(document.id, document.editorKey, '"1"', '{"by":"editor"}'),
      saveVersion(document.id, document.managerKey, '"1"', '{"by":"manager"}'),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 412]);
    expect(await storedVersions(document.id)).toEqual([1, 2]);
  });

  it("checks If-Match before reading the body", async () => {
    const document = await createDocument();
    await saveVersions(document, 1);

    const response = await saveVersion(document.id, document.editorKey, '"1"', "not json");

    expect(response.status).toBe(412);
  });

  it("refuses a reader key with 403", async () => {
    const document = await createDocument();

    const response = await saveVersion(document.id, document.readerKey, '"1"');

    expect(response.status).toBe(403);
    expect(await storedVersions(document.id)).toEqual([1]);
  });

  it("gives every authentication failure the same 401 as GET", async () => {
    const [document, other] = [await createDocument(), await createDocument()];
    const baseline = await (await getLatest(document.id, null)).text();

    for (const [description, documentId, key] of await authenticationFailures(document, other)) {
      const response =
        key === null
          ? await request(`/v1/documents/${documentId}/versions`, {
              method: "POST",
              body: "{}",
              headers: { "Content-Type": "application/json", "If-Match": '"1"' },
            })
          : await saveVersion(documentId, key, '"1"');

      expect.soft(response.status, description).toBe(401);
      expect.soft(await response.text(), description).toBe(baseline);
    }
  });

  // Naming the deletion marker instead restores the document: see restore.spec.ts.
  it("refuses a save on a deleted document with 410 when If-Match names an older version", async () => {
    const document = await createDocument();
    await markDeleted(document.id, 2);

    const response = await saveVersion(document.id, document.editorKey, '"1"');

    expect(response.status).toBe(410);
    expect(await storedVersions(document.id)).toEqual([1, 2]);
  });

  it.each([
    ["text/plain", "{}", { "Content-Type": "text/plain" }, 415],
    ["an oversized body", jsonObjectOfSize(MAX_DOCUMENT_BYTES + 1), {}, 413],
    ["invalid JSON", "{", {}, 400],
    ["an array", "[]", {}, 422],
  ])("checks the body: %s", async (_description, body, headers, status) => {
    const document = await createDocument();

    const response = await saveVersion(document.id, document.editorKey, '"1"', body, headers);

    expect(response.status).toBe(status);
    expect(await storedVersions(document.id)).toEqual([1]);
  });
});

describe("retention", () => {
  it(`keeps only the newest ${String(MAX_VERSIONS)} versions`, async () => {
    const document = await createDocument();

    await saveVersions(document, MAX_VERSIONS);

    expect(await storedVersions(document.id)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("never prunes the published version, however old", async () => {
    const document = await createDocument();
    expect((await publish(document.id, document.editorKey, 1)).status).toBe(204);

    await saveVersions(document, MAX_VERSIONS + 5);

    expect(await storedVersions(document.id)).toEqual([1, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });
});
