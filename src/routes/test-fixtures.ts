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
