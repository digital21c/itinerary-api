import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { generateKey, hashKey } from "../auth/keys";
import app from "../index";
import { MAX_DOCUMENT_BYTES, MAX_DOCUMENTS_PER_CREATOR_KEY } from "../models/limits";
import {
  type CreatedDocument,
  createDocument as createDocumentWith,
  insertCreatorKey,
  jsonObjectOfSize,
  postDocument,
  withKey as asCreator,
} from "./test-fixtures";

function createDocument(creatorKey: string, body?: unknown): Promise<CreatedDocument> {
  return createDocumentWith({ creatorKey, body });
}

describe("POST /v1/documents: authentication", () => {
  const notStored = {
    creator: generateKey("creator"),
    reader: generateKey("reader"),
    editor: generateKey("editor"),
    manager: generateKey("manager"),
  };

  async function failureCases(): Promise<[string, Record<string, string>, string | null][]> {
    const revoked = await insertCreatorKey({ revokedAt: "2026-01-01T00:00:00.000Z" });
    const expired = await insertCreatorKey({ expiresAt: "2026-01-01T00:00:00.000Z" });
    const document = await createDocument((await insertCreatorKey()).key);
    const json = { "Content-Type": "application/json" };

    return [
      ["no Authorization header", json, null],
      [
        "another scheme",
        { ...json, Authorization: `Basic ${notStored.creator}` },
        notStored.creator,
      ],
      ["a malformed key", { ...json, Authorization: "Bearer ck_short" }, "ck_short"],
      ["an unknown creator key", asCreator(notStored.creator), notStored.creator],
      ["a revoked creator key", asCreator(revoked.key), revoked.key],
      ["an expired creator key", asCreator(expired.key), expired.key],
      ["a reader key", asCreator(notStored.reader), notStored.reader],
      ["an editor key", asCreator(notStored.editor), notStored.editor],
      ["a manager key", asCreator(notStored.manager), notStored.manager],
      ["a real document's manager key", asCreator(document.managerKey), document.managerKey],
      ["a real document's reader key", asCreator(document.readerKey), document.readerKey],
    ];
  }

  it("gives every failure the same 401, which never contains the key", async () => {
    const cases = await failureCases();
    const responses = await Promise.all(
      cases.map(async ([description, headers, key]) => {
        const response = await postDocument('{"title":"x"}', headers);
        return { description, key, response, text: await response.text() };
      }),
    );

    const [first] = responses;
    for (const { description, key, response, text } of responses) {
      expect.soft(response.status, description).toBe(401);
      expect.soft(response.headers.get("WWW-Authenticate"), description).toBe("Bearer");
      expect.soft(text, description).toBe(first?.text);
      if (key !== null) {
        expect.soft(text.includes(key), description).toBe(false);
      }
    }
  });

  it("authenticates before looking at the body", async () => {
    const response = await postDocument("not json", { "Content-Type": "text/plain" });

    expect(response.status).toBe(401);
  });

  it("accepts the scheme name in any case", async () => {
    const { key } = await insertCreatorKey();
    const response = await postDocument('{"title":"x"}', {
      Authorization: `bearer ${key}`,
      "Content-Type": "application/json",
    });

    expect(response.status).toBe(201);
  });

  it("accepts a creator key that hasn't expired yet", async () => {
    const { key } = await insertCreatorKey({ expiresAt: "2999-01-01T00:00:00.000Z" });

    await createDocument(key);
  });

  it("keeps a creator key's documents when the key is revoked", async () => {
    const creator = await insertCreatorKey();
    const document = await createDocument(creator.key);

    await env.DB.prepare("update creator_keys set revoked_at = ?1 where id = ?2")
      .bind(new Date().toISOString(), creator.id)
      .run();

    const afterRevocation = await postDocument('{"title":"x"}', asCreator(creator.key));
    expect(afterRevocation.status).toBe(401);

    const kept = await env.DB.prepare(
      `select (select count(*) from documents where id = ?1) as documents,
              (select count(*) from document_versions where document_id = ?1) as versions,
              (select count(*) from document_keys where document_id = ?1 and revoked_at is null)
                as keys`,
    )
      .bind(document.id)
      .first();
    expect(kept).toEqual({ documents: 1, versions: 1, keys: 3 });
  });
});

describe("POST /v1/documents: the body", () => {
  it.each([
    ["no Content-Type", undefined],
    ["text/plain", "text/plain"],
    ["form data", "application/x-www-form-urlencoded"],
  ])("refuses %s with 415", async (_description, contentType) => {
    const { key } = await insertCreatorKey();
    const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
    if (contentType !== undefined) {
      headers["Content-Type"] = contentType;
    }

    const response = await postDocument('{"title":"x"}', headers);

    expect(response.status).toBe(415);
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
  });

  it("accepts application/json with a charset", async () => {
    const { key } = await insertCreatorKey();
    const response = await postDocument('{"title":"x"}', {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json; charset=utf-8",
    });

    expect(response.status).toBe(201);
  });

  it("accepts a body of exactly the maximum size", async () => {
    const { key } = await insertCreatorKey();
    const body = jsonObjectOfSize(MAX_DOCUMENT_BYTES);

    const response = await postDocument(body, asCreator(key));

    expect(response.status).toBe(201);
  });

  it("refuses a body one byte over the maximum with 413", async () => {
    const { key } = await insertCreatorKey();
    const body = jsonObjectOfSize(MAX_DOCUMENT_BYTES + 1);

    const response = await postDocument(body, asCreator(key));

    expect(response.status).toBe(413);
  });

  it("counts bytes, not characters", async () => {
    const { key } = await insertCreatorKey();
    // "é" is 2 bytes in UTF-8, so this is under the limit in characters but over it in bytes.
    const characters = MAX_DOCUMENT_BYTES / 2 + 10;
    const body = `{"padding":"${"é".repeat(characters - 14)}"}`;

    const response = await postDocument(body, asCreator(key));

    expect(response.status).toBe(413);
  });

  it("refuses an oversized body sent without Content-Length", async () => {
    const { key } = await insertCreatorKey();
    const bytes = new TextEncoder().encode(jsonObjectOfSize(MAX_DOCUMENT_BYTES + 1));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Several chunks, so the limit is crossed part-way through reading.
        for (let offset = 0; offset < bytes.length; offset += 16_384) {
          controller.enqueue(bytes.slice(offset, offset + 16_384));
        }
        controller.close();
      },
    });

    const response = await postDocument(stream, asCreator(key));

    expect(response.status).toBe(413);
  });

  it.each([
    ["isn't JSON", "not json", 400],
    ["is truncated JSON", '{"title":', 400],
    ["is empty", "", 400],
    ["is an array", "[1, 2]", 422],
    ["is a string", '"trip"', 422],
    ["is a number", "42", 422],
    ["is null", "null", 422],
  ])("refuses a body that %s", async (_description, body, status) => {
    const { key } = await insertCreatorKey();

    const response = await postDocument(body, asCreator(key));

    expect(response.status).toBe(status);
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
  });

  it("refuses a body that isn't UTF-8 with 400", async () => {
    const { key } = await insertCreatorKey();
    const body = new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]); // {"\xff":1}

    const response = await postDocument(body, asCreator(key));

    expect(response.status).toBe(400);
  });
});

describe("POST /v1/documents: the cap on documents per creator key", () => {
  it("refuses a create once the creator key has reached its cap", async () => {
    const creator = await insertCreatorKey();
    const now = new Date().toISOString();
    await env.DB.batch(
      Array.from({ length: MAX_DOCUMENTS_PER_CREATOR_KEY }, () =>
        env.DB.prepare(
          "insert into documents (id, type, created_at, created_by) values (?1, 'itinerary', ?2, ?3)",
        ).bind(crypto.randomUUID(), now, creator.id),
      ),
    );

    const response = await postDocument('{"title":"x"}', asCreator(creator.key));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      type: "/problems/document-limit-reached",
      status: 409,
    });
  });

  it("allows the last document under the cap", async () => {
    const creator = await insertCreatorKey();
    const now = new Date().toISOString();
    await env.DB.batch(
      Array.from({ length: MAX_DOCUMENTS_PER_CREATOR_KEY - 1 }, () =>
        env.DB.prepare(
          "insert into documents (id, type, created_at, created_by) values (?1, 'itinerary', ?2, ?3)",
        ).bind(crypto.randomUUID(), now, creator.id),
      ),
    );

    await createDocument(creator.key);
  });
});

describe("POST /v1/documents: success", () => {
  it("returns 201 with the location, version 1 and no caching", async () => {
    const { key } = await insertCreatorKey();

    const response = await postDocument('{"title":"x"}', asCreator(key));
    const created = await response.json<CreatedDocument>();

    expect(response.status).toBe(201);
    expect(response.headers.get("Location")).toBe(`/v1/documents/${created.id}`);
    expect(response.headers.get("ETag")).toBe('"1"');
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(Object.keys(created).sort()).toEqual(["editorKey", "id", "managerKey", "readerKey"]);
    expect(created.managerKey).toMatch(/^mk_[A-Za-z0-9_-]{43}$/);
    expect(created.editorKey).toMatch(/^ek_[A-Za-z0-9_-]{43}$/);
    expect(created.readerKey).toMatch(/^rk_[A-Za-z0-9_-]{43}$/);
  });

  it("stores the document, version 1 and the hashes of the three keys", async () => {
    const creator = await insertCreatorKey();
    const body = { title: "Kyoto in spring", days: [{ day: 1, city: "Kyoto" }] };

    const created = await createDocument(creator.key, body);

    const document = await env.DB.prepare("select type, created_by from documents where id = ?1")
      .bind(created.id)
      .first();
    expect(document).toEqual({ type: "itinerary", created_by: creator.id });

    const versions = await env.DB.prepare(
      "select version, body, deleted, created_by from document_versions where document_id = ?1",
    )
      .bind(created.id)
      .all();
    expect(versions.results).toEqual([
      { version: 1, body: JSON.stringify(body), deleted: 0, created_by: null },
    ]);

    const keys = await env.DB.prepare(
      `select permission, hex(key_hash) as hash, expires_at, revoked_at from document_keys
       where document_id = ?1 order by permission`,
    )
      .bind(created.id)
      .all();
    const hexHash = async (key: string) => (await hashKey(key)).toHex().toUpperCase();
    expect(keys.results).toEqual([
      {
        permission: "editor",
        hash: await hexHash(created.editorKey),
        expires_at: null,
        revoked_at: null,
      },
      {
        permission: "manager",
        hash: await hexHash(created.managerKey),
        expires_at: null,
        revoked_at: null,
      },
      {
        permission: "reader",
        hash: await hexHash(created.readerKey),
        expires_at: null,
        revoked_at: null,
      },
    ]);
  });

  it("never stores a key in plain text", async () => {
    const { key } = await insertCreatorKey();
    const created = await createDocument(key);

    const rows = await env.DB.prepare("select * from document_keys where document_id = ?1")
      .bind(created.id)
      .all();
    const stored = JSON.stringify(rows.results);

    for (const issued of [created.managerKey, created.editorKey, created.readerKey]) {
      expect(stored.includes(issued.slice(3))).toBe(false);
    }
  });

  it("leaves the document unpublished", async () => {
    const { key } = await insertCreatorKey();
    const created = await createDocument(key);

    const publication = await env.DB.prepare(
      "select * from document_publications where document_id = ?1",
    )
      .bind(created.id)
      .first();
    expect(publication).toBeNull();
  });

  it("records when the creator key was last used", async () => {
    const creator = await insertCreatorKey();
    const before = new Date().toISOString();

    await createDocument(creator.key);

    const row = await env.DB.prepare("select last_used_at from creator_keys where id = ?1")
      .bind(creator.id)
      .first<{ last_used_at: string }>();
    expect((row?.last_used_at ?? "") >= before).toBe(true);
  });
});

describe("CORS", () => {
  it("answers a preflight from any origin, without credentials", async () => {
    const response = await app.request(
      "/v1/documents",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://planner.example",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization, content-type",
        },
      },
      env,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("lets browser clients read ETag and Location", async () => {
    const { key } = await insertCreatorKey();
    const response = await postDocument('{"title":"x"}', {
      ...asCreator(key),
      Origin: "https://planner.example",
    });

    expect(response.headers.get("Access-Control-Expose-Headers")).toBe("ETag,Location");
  });
});
