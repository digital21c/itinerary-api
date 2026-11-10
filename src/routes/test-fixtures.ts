/**
 * Shared helpers for route tests. Test-only: nothing in the app imports this.
 *
 * D1 storage is shared by the tests within one file, so every helper makes fresh IDs and keys
 * rather than relying on an empty database.
 */
import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { generateKey, hashKey } from "../auth/keys";
import app from "../index";

export interface CreatorKeyFixture {
  id: string;
  key: string;
}

export async function insertCreatorKey(
  options: { expiresAt?: string; revokedAt?: string } = {},
): Promise<CreatorKeyFixture> {
  const id = crypto.randomUUID();
  const key = generateKey("creator");
  await env.DB.prepare(
    `insert into creator_keys (id, key_hash, label, created_at, expires_at, revoked_at)
     values (?1, ?2, 'test', ?3, ?4, ?5)`,
  )
    .bind(
      id,
      await hashKey(key),
      new Date().toISOString(),
      options.expiresAt ?? null,
      options.revokedAt ?? null,
    )
    .run();
  return { id, key };
}

export function request(path: string, init: RequestInit = {}): Promise<Response> {
  return Promise.resolve(app.request(path, init, env));
}

export function postDocument(
  body: BodyInit | null,
  headers: Record<string, string> = {},
): Promise<Response> {
  return request("/v1/documents", { method: "POST", body, headers });
}

/** `Authorization` for the key, plus a JSON `Content-Type`. */
export function withKey(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

export interface CreatedDocument {
  id: string;
  managerKey: string;
  editorKey: string;
  readerKey: string;
}

/** A new document through the API, with a creator key of its own unless one is given. */
export async function createDocument(
  options: { creatorKey?: string; body?: unknown } = {},
): Promise<CreatedDocument> {
  const creatorKey = options.creatorKey ?? (await insertCreatorKey()).key;
  const response = await postDocument(
    JSON.stringify(options.body ?? { title: "Test trip" }),
    withKey(creatorKey),
  );
  expect(response.status).toBe(201);
  return response.json<CreatedDocument>();
}

/** A JSON object whose UTF-8 encoding is exactly `bytes` long. */
export function jsonObjectOfSize(bytes: number): string {
  const wrapper = '{"padding":""}';
  return `{"padding":"${"x".repeat(bytes - wrapper.length)}"}`;
}

export function getLatest(
  documentId: string,
  key: string | null,
  headers: Record<string, string> = {},
): Promise<Response> {
  return request(`/v1/documents/${documentId}`, { headers: { ...authorization(key), ...headers } });
}

export function getPublished(
  documentId: string,
  key: string | null,
  headers: Record<string, string> = {},
): Promise<Response> {
  return request(`/v1/documents/${documentId}/published`, {
    headers: { ...authorization(key), ...headers },
  });
}

/** `PUT …/published` with `{ "version": version }`, or with `body` as given. */
export function publish(
  documentId: string,
  key: string,
  version: number,
  body: BodyInit = JSON.stringify({ version }),
  headers: Record<string, string> = {},
): Promise<Response> {
  return request(`/v1/documents/${documentId}/published`, {
    method: "PUT",
    body,
    headers: { ...withKey(key), ...headers },
  });
}

export function unpublish(documentId: string, key: string | null): Promise<Response> {
  return request(`/v1/documents/${documentId}/published`, {
    method: "DELETE",
    headers: authorization(key),
  });
}

function authorization(key: string | null): Record<string, string> {
  return key === null ? {} : { Authorization: `Bearer ${key}` };
}

export function saveVersion(
  documentId: string,
  key: string,
  ifMatch: string | null,
  body: BodyInit = '{"title":"Edited"}',
  headers: Record<string, string> = {},
): Promise<Response> {
  const precondition: Record<string, string> = ifMatch === null ? {} : { "If-Match": ifMatch };
  return request(`/v1/documents/${documentId}/versions`, {
    method: "POST",
    body,
    headers: { ...withKey(key), ...precondition, ...headers },
  });
}

/** Saves `count` versions in turn, each over the previous one. */
export async function saveVersions(document: CreatedDocument, count: number): Promise<void> {
  for (let base = 1; base <= count; base++) {
    const response = await saveVersion(
      document.id,
      document.editorKey,
      `"${String(base)}"`,
      JSON.stringify({ title: `Version ${String(base + 1)}` }),
    );
    expect(response.status).toBe(201);
  }
}

export async function storedVersions(documentId: string): Promise<number[]> {
  const { results } = await env.DB.prepare(
    "select version from document_versions where document_id = ?1 order by version",
  )
    .bind(documentId)
    .all<{ version: number }>();
  return results.map((row) => row.version);
}

/** Inserts a deletion marker directly, until DELETE exists (build step 7). */
export async function markDeleted(documentId: string, version: number): Promise<void> {
  await env.DB.prepare(
    `insert into document_versions (document_id, version, body, deleted, created_at)
     values (?1, ?2, null, 1, ?3)`,
  )
    .bind(documentId, version, new Date().toISOString())
    .run();
}

export async function setKeyColumn(
  key: string,
  column: "revoked_at" | "expires_at",
  value: string,
) {
  await env.DB.prepare(`update document_keys set ${column} = ?1 where key_hash = ?2`)
    .bind(value, await hashKey(key))
    .run();
}

/** Each way a request can fail authentication, given a document and another document. */
export async function authenticationFailures(
  document: CreatedDocument,
  other: CreatedDocument,
): Promise<[string, string, string | null][]> {
  const revoked = (await createDocument()).editorKey;
  const expired = (await createDocument()).editorKey;
  await setKeyColumn(revoked, "revoked_at", "2026-01-01T00:00:00.000Z");
  await setKeyColumn(expired, "expires_at", "2026-01-01T00:00:00.000Z");
  const revokedOn = await documentOfKey(revoked);
  const expiredOn = await documentOfKey(expired);

  return [
    ["no key", document.id, null],
    ["a malformed key", document.id, "ek_short"],
    ["a creator key", document.id, (await insertCreatorKey()).key],
    ["an editor key that was never issued", document.id, generateKey("editor")],
    ["another document's manager key", document.id, other.managerKey],
    ["a document that doesn't exist", crypto.randomUUID(), document.editorKey],
    ["an ID that isn't a UUID", "not-a-uuid", document.editorKey],
    ["a revoked editor key", revokedOn, revoked],
    ["an expired editor key", expiredOn, expired],
  ];
}

export async function documentOfKey(key: string): Promise<string> {
  const row = await env.DB.prepare("select document_id from document_keys where key_hash = ?1")
    .bind(await hashKey(key))
    .first<{ document_id: string }>();
  if (row === null) {
    throw new Error("The key isn't stored.");
  }
  return row.document_id;
}

export interface KeySummary {
  id: string;
  permission: "reader" | "editor" | "manager";
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  status: "active" | "expired" | "revoked";
  isCurrentKey: boolean;
}

export interface IssuedKey {
  id: string;
  key: string;
  permission: "reader" | "editor" | "manager";
  label: string;
  expiresAt: string | null;
}

export function listKeys(documentId: string, key: string | null): Promise<Response> {
  return request(`/v1/documents/${documentId}/keys`, { headers: authorization(key) });
}

/** The key list as a manager sees it. */
export async function keysOf(documentId: string, managerKey: string): Promise<KeySummary[]> {
  const response = await listKeys(documentId, managerKey);
  expect(response.status).toBe(200);
  return (await response.json<{ keys: KeySummary[] }>()).keys;
}

/** The key list entry for a key, found by its plaintext. */
export async function summaryOf(
  documentId: string,
  managerKey: string,
  key: string,
): Promise<KeySummary> {
  const id = await keyIdOf(key);
  const summary = (await keysOf(documentId, managerKey)).find((entry) => entry.id === id);
  if (summary === undefined) {
    throw new Error("The key isn't listed.");
  }
  return summary;
}

export function issueKey(
  documentId: string,
  key: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return request(`/v1/documents/${documentId}/keys`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { ...withKey(key), ...headers },
  });
}

/** Issues a key and returns it, failing the test unless it was issued. */
export async function issued(
  documentId: string,
  managerKey: string,
  body: { permission: string; label?: string; expiresAt?: string },
): Promise<IssuedKey> {
  const response = await issueKey(documentId, managerKey, { label: "Test key", ...body });
  expect(response.status).toBe(201);
  return response.json<IssuedKey>();
}

export function setKeyExpiry(
  documentId: string,
  key: string,
  keyId: string,
  body: unknown,
  contentType = "application/merge-patch+json",
): Promise<Response> {
  return request(`/v1/documents/${documentId}/keys/${keyId}`, {
    method: "PATCH",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { ...authorization(key), "Content-Type": contentType },
  });
}

export function revokeKey(
  documentId: string,
  key: string | null,
  keyId: string,
): Promise<Response> {
  return request(`/v1/documents/${documentId}/keys/${keyId}`, {
    method: "DELETE",
    headers: authorization(key),
  });
}

/** A key's public ID, found by its hash. */
export async function keyIdOf(key: string): Promise<string> {
  const row = await env.DB.prepare("select id from document_keys where key_hash = ?1")
    .bind(await hashKey(key))
    .first<{ id: string }>();
  if (row === null) {
    throw new Error("The key isn't stored.");
  }
  return row.id;
}

/** A key's stored row, found by its plaintext. */
export async function storedKeyRow(key: string) {
  return env.DB.prepare(
    "select permission, label, last_used_at, expires_at, revoked_at from document_keys where key_hash = ?1",
  )
    .bind(await hashKey(key))
    .first<{
      permission: string;
      label: string | null;
      last_used_at: string | null;
      expires_at: string | null;
      revoked_at: string | null;
    }>();
}
