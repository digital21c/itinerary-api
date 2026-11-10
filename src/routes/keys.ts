import { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { unauthorized } from "../auth/bearer";
import { lookUpWithDocumentKey } from "../auth/document-key";
import { generateKey, hashKey } from "../auth/keys";
import { dateFromExpiresAt } from "../models/expiry";
import {
  chooseExpiry,
  issueKeyRequestSchema,
  keyStatus,
  MAX_KEY_REQUEST_BYTES,
  setExpiryRequestSchema,
} from "../models/keys";
import { MAX_KEYS_PER_DOCUMENT } from "../models/limits";
import { allows } from "../models/permissions";
import type { StoredKey } from "../repositories/types";
import { readJsonBody } from "./json-body";
import {
  cannotRevokeOwnKey,
  documentGone,
  forbidden,
  keyLimitReached,
  keyNotFound,
  keyRevoked,
  unprocessable,
} from "./problems";

/**
 * `/v1/documents/{id}/keys`: a manager lists, issues, changes the expiry of and revokes the
 * document's keys. Manager keys only; every write also checks, in the statement itself,
 * that the manager's own key is still active.
 */
export const keyRoutes = new Hono<AppEnv>();

/** Key management responses are security information: never kept by any cache. */
const NO_STORE = { "Cache-Control": "no-store" };

/** A key as the API shows it: never the key itself or its hash. Expiry is the last valid day. */
function keySummary(key: StoredKey, currentKeyId: string, now: Date) {
  return {
    id: key.id,
    permission: key.permission,
    label: key.label,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
    expiresAt: key.expiresAt === null ? null : dateFromExpiresAt(key.expiresAt),
    revokedAt: key.revokedAt,
    status: keyStatus(key, now),
    isCurrentKey: key.id === currentKeyId,
  };
}

/** List all the document's keys, revoked and expired ones included. */
keyRoutes.get("/:id/keys", async (c) => {
  const documentId = c.req.param("id");
  const { documents, keys } = c.var.repositories;
  const found = await lookUpWithDocumentKey(
    documentId,
    c.req.header("Authorization"),
    (id, keyHash, now) => documents.findLatestHead(id, keyHash, now),
    keys,
  );
  if (found === null) {
    return unauthorized();
  }
  if (!allows(found.key.permission, "manage-keys")) {
    return forbidden();
  }

  const now = new Date();
  const stored = await keys.list(documentId);
  return c.json(
    { keys: stored.map((key) => keySummary(key, found.key.keyId, now)) },
    200,
    NO_STORE,
  );
});

/** Issue a key. The key itself is in this response only. */
keyRoutes.post("/:id/keys", async (c) => {
  const documentId = c.req.param("id");
  const { documents, keys } = c.var.repositories;
  const found = await lookUpWithDocumentKey(
    documentId,
    c.req.header("Authorization"),
    (id, keyHash, now) => documents.findLatestHead(id, keyHash, now),
    keys,
  );
  if (found === null) {
    return unauthorized();
  }
  if (!allows(found.key.permission, "manage-keys")) {
    return forbidden();
  }
  if (found.latest.deleted) {
    return documentGone();
  }

  const read = await readJsonBody(c.req.raw, {
    maxBytes: MAX_KEY_REQUEST_BYTES,
    schema: issueKeyRequestSchema,
    invalidDetail:
      'The body must be { "permission": "reader" | "editor" | "manager", "label": <1 to 100 ' +
      'characters>, "expiresAt"?: "YYYY-MM-DD" }.',
  });
  if (!read.ok) {
    return read.response;
  }
  const { permission, label } = read.value;
  const now = new Date();
  const expiry = chooseExpiry(read.value.expiresAt, permission, now);
  if (!expiry.ok) {
    return unprocessable(expiry.detail);
  }

  const id = crypto.randomUUID();
  const key = generateKey(permission);
  const outcome = await keys.issue(
    {
      documentId,
      id,
      keyHash: await hashKey(key),
      permission,
      label,
      createdAt: now.toISOString(),
      expiresAt: expiry.expiresAt,
    },
    found.key.keyId,
    MAX_KEYS_PER_DOCUMENT,
  );
  if (outcome === "limit-reached") {
    return keyLimitReached(MAX_KEYS_PER_DOCUMENT);
  }
  if (outcome === "requester-inactive") {
    return unauthorized();
  }

  return c.json(
    {
      id,
      key,
      permission,
      label,
      expiresAt: expiry.expiresAt === null ? null : dateFromExpiresAt(expiry.expiresAt),
    },
    201,
    { ...NO_STORE, Location: `/v1/documents/${documentId}/keys/${id}` },
  );
});

/**
 * Change a key's expiry: `{ "expiresAt": "YYYY-MM-DD" }` sets or extends it (reactivating an
 * expired key), `{ "expiresAt": null }` removes it. The body is a JSON Merge Patch (RFC 7396).
 */
keyRoutes.patch("/:id/keys/:keyId", async (c) => {
  const documentId = c.req.param("id");
  const keys = c.var.repositories.keys;
  const found = await lookUpWithDocumentKey(
    documentId,
    c.req.header("Authorization"),
    (id, keyHash, now) => keys.findWithTarget(id, keyHash, c.req.param("keyId"), now),
    keys,
  );
  if (found === null) {
    return unauthorized();
  }
  if (!allows(found.key.permission, "manage-keys")) {
    return forbidden();
  }
  const target = found.target;
  if (target === null) {
    return keyNotFound();
  }
  if (target.revokedAt !== null) {
    return keyRevoked();
  }

  const read = await readJsonBody(c.req.raw, {
    maxBytes: MAX_KEY_REQUEST_BYTES,
    schema: setExpiryRequestSchema,
    invalidDetail: 'The body must be { "expiresAt": "YYYY-MM-DD" } or { "expiresAt": null }.',
    mediaTypes: ["application/merge-patch+json", "application/json"],
  });
  if (!read.ok) {
    return read.response;
  }
  const now = new Date();
  const expiry = chooseExpiry(read.value.expiresAt, target.permission, now);
  if (!expiry.ok) {
    return unprocessable(expiry.detail);
  }

  const outcome = await keys.setExpiry({
    documentId,
    targetId: target.id,
    expiresAt: expiry.expiresAt,
    requesterId: found.key.keyId,
    now,
  });
  if (outcome === "requester-inactive") {
    return unauthorized();
  }
  if (outcome === "target-revoked") {
    return keyRevoked();
  }
  return new Response(null, { status: 204 });
});

/** Revoke a key. Immediate, and safe to repeat. A manager key can't revoke itself. */
keyRoutes.delete("/:id/keys/:keyId", async (c) => {
  const documentId = c.req.param("id");
  const keys = c.var.repositories.keys;
  const found = await lookUpWithDocumentKey(
    documentId,
    c.req.header("Authorization"),
    (id, keyHash, now) => keys.findWithTarget(id, keyHash, c.req.param("keyId"), now),
    keys,
  );
  if (found === null) {
    return unauthorized();
  }
  if (!allows(found.key.permission, "manage-keys")) {
    return forbidden();
  }
  if (found.target === null) {
    return keyNotFound();
  }
  if (found.target.id === found.key.keyId) {
    return cannotRevokeOwnKey();
  }

  const outcome = await keys.revoke({
    documentId,
    targetId: found.target.id,
    requesterId: found.key.keyId,
    now: new Date(),
  });
  if (outcome === "requester-inactive") {
    return unauthorized();
  }
  return new Response(null, { status: 204 });
});
