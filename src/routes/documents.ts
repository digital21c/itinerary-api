import { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { unauthorized } from "../auth/bearer";
import { requireCreatorKey } from "../auth/creator-key";
import { lookUpWithDocumentKey } from "../auth/document-key";
import { documentBodySchema } from "../models/document-body";
import { MAX_DOCUMENT_BYTES, MAX_DOCUMENTS_PER_CREATOR_KEY, MAX_VERSIONS } from "../models/limits";
import { applyMergePatch, isJsonObject } from "../models/merge-patch";
import { planNewDocument } from "../models/new-document";
import { allows } from "../models/permissions";
import { nextVersion, parseVersionNumber } from "../models/versions";
import type { DocumentRepository } from "../repositories/types";
import { strongTag } from "../utils/entity-tags";
import { problemResponse } from "../utils/problem";
import { readDocumentBody } from "./document-body";
import { readJsonBody } from "./json-body";
import { checkWritePreconditions } from "./preconditions";
import {
  documentGone,
  forbidden,
  preconditionFailed,
  unprocessable,
  versionIsDeletionMarker,
  versionNotFound,
  versionPruned,
} from "./problems";
import { IMMUTABLE, versionResponse } from "./version-response";

/** Routes under /v1/documents. */
export const documentRoutes = new Hono<AppEnv>();

/** Create a document. Requires a creator key. */
documentRoutes.post("/", requireCreatorKey, async (c) => {
  const read = await readDocumentBody(c.req.raw);
  if (!read.ok) {
    return read.response;
  }

  const creatorKey = c.var.creatorKey;
  if (creatorKey.documentCount >= MAX_DOCUMENTS_PER_CREATOR_KEY) {
    return problemResponse({
      status: 409,
      type: "/problems/document-limit-reached",
      title: "Document limit reached",
      detail: `This creator key can create at most ${String(MAX_DOCUMENTS_PER_CREATOR_KEY)} documents.`,
    });
  }

  const { document, issuedKeys } = await planNewDocument({
    body: read.value,
    creatorKeyId: creatorKey.id,
    now: new Date(),
  });
  await c.var.repositories.documents.create(document);

  // The keys are in this response only, so nothing may cache it.
  return c.json({ id: document.id, ...issuedKeys }, 201, {
    Location: `/v1/documents/${document.id}`,
    ETag: strongTag("1"),
    "Cache-Control": "no-store",
  });
});

/** The latest working version. Requires an editor or manager key. */
documentRoutes.get("/:id", async (c) => {
  const documents = c.var.repositories.documents;
  const found = await lookUpWithDocumentKey(
    c.req.param("id"),
    c.req.header("Authorization"),
    (documentId, keyHash, now) => documents.findLatest(documentId, keyHash, now),
    c.var.repositories.keys,
  );
  if (found === null) {
    return unauthorized();
  }
  if (!allows(found.key.permission, "read-drafts")) {
    return forbidden();
  }
  const { version, body } = found.latest;
  if (found.latest.deleted || body === null) {
    return documentGone();
  }
  return versionResponse(version, body, c.req.header("If-None-Match"));
});

/**
 * Save a new full version. Requires an editor or manager key and If-Match. On a deleted
 * document, an If-Match naming the deletion marker restores it (unpublished).
 */
documentRoutes.post("/:id/versions", async (c) => {
  const documentId = c.req.param("id");
  const documents = c.var.repositories.documents;
  const found = await lookUpWithDocumentKey(
    documentId,
    c.req.header("Authorization"),
    (id, keyHash, now) => documents.findLatestHead(id, keyHash, now),
    c.var.repositories.keys,
  );
  if (found === null) {
    return unauthorized();
  }
  if (!allows(found.key.permission, "write")) {
    return forbidden();
  }
  const precondition = checkWritePreconditions(c.req.header("If-Match"), found.latest, {
    allowRestore: true,
  });
  if (!precondition.ok) {
    return precondition.response;
  }

  const read = await readDocumentBody(c.req.raw);
  if (!read.ok) {
    return read.response;
  }
  return saveNewVersion(c.var.repositories.documents, {
    documentId,
    baseVersion: precondition.baseVersion,
    body: JSON.stringify(read.value),
    createdBy: found.key.keyId,
  });
});

/**
 * Change part of the latest version with a JSON Merge Patch (RFC 7396), stored as a new full
 * version. Requires an editor or manager key and If-Match.
 */
documentRoutes.patch("/:id", async (c) => {
  const documentId = c.req.param("id");
  const documents = c.var.repositories.documents;
  const found = await lookUpWithDocumentKey(
    documentId,
    c.req.header("Authorization"),
    (id, keyHash, now) => documents.findLatest(id, keyHash, now),
    c.var.repositories.keys,
  );
  if (found === null) {
    return unauthorized();
  }
  if (!allows(found.key.permission, "write")) {
    return forbidden();
  }
  const precondition = checkWritePreconditions(c.req.header("If-Match"), found.latest, {
    allowRestore: false,
  });
  if (!precondition.ok) {
    return precondition.response;
  }
  // Not deleted (checked above), so the latest version has a body.
  const latestBody = found.latest.body ?? "{}";

  const read = await readJsonBody(c.req.raw, {
    maxBytes: MAX_DOCUMENT_BYTES,
    schema: documentBodySchema,
    invalidDetail: "A merge patch for a document must be a JSON object.",
    mediaTypes: ["application/merge-patch+json", "application/json"],
  });
  if (!read.ok) {
    return read.response;
  }

  const patched = applyMergePatch(JSON.parse(latestBody), read.value);
  const body = JSON.stringify(patched);
  if (!isJsonObject(patched)) {
    return unprocessable("The patched document must be a JSON object.");
  }
  if (new TextEncoder().encode(body).byteLength > MAX_DOCUMENT_BYTES) {
    return unprocessable(`The patched document would be over ${String(MAX_DOCUMENT_BYTES)} bytes.`);
  }
  return saveNewVersion(documents, {
    documentId,
    baseVersion: precondition.baseVersion,
    body,
    createdBy: found.key.keyId,
  });
});

/**
 * Delete the document: stores a deletion marker as the next version and unpublishes it.
 * Requires an editor or manager key and If-Match. It can be restored until it is purged.
 */
documentRoutes.delete("/:id", async (c) => {
  const documentId = c.req.param("id");
  const documents = c.var.repositories.documents;
  const found = await lookUpWithDocumentKey(
    documentId,
    c.req.header("Authorization"),
    (id, keyHash, now) => documents.findLatestHead(id, keyHash, now),
    c.var.repositories.keys,
  );
  if (found === null) {
    return unauthorized();
  }
  if (!allows(found.key.permission, "write")) {
    return forbidden();
  }
  const precondition = checkWritePreconditions(c.req.header("If-Match"), found.latest, {
    allowRestore: false,
  });
  if (!precondition.ok) {
    return precondition.response;
  }

  const markerVersion = nextVersion(precondition.baseVersion);
  const outcome = await documents.deleteDocument(
    {
      documentId,
      baseVersion: precondition.baseVersion,
      markerVersion,
      createdAt: new Date().toISOString(),
      createdBy: found.key.keyId,
    },
    MAX_VERSIONS,
  );
  if (outcome === "stale") {
    return preconditionFailed();
  }
  // The marker's tag is what a client needs to restore the document.
  return new Response(null, {
    status: 204,
    headers: { ETag: strongTag(String(markerVersion)) },
  });
});

/** The retained versions, newest first, without bodies. Works while deleted. */
documentRoutes.get("/:id/versions", async (c) => {
  const documentId = c.req.param("id");
  const documents = c.var.repositories.documents;
  const found = await lookUpWithDocumentKey(
    documentId,
    c.req.header("Authorization"),
    (id, keyHash, now) => documents.findLatestHead(id, keyHash, now),
    c.var.repositories.keys,
  );
  if (found === null) {
    return unauthorized();
  }
  if (!allows(found.key.permission, "read-drafts")) {
    return forbidden();
  }

  const history = await documents.history(documentId);
  const versions = history.versions;
  return c.json(
    {
      latest: versions[0]?.version ?? found.latest.version,
      oldestAvailable: versions[versions.length - 1]?.version ?? found.latest.version,
      published: history.published,
      versions,
    },
    200,
    { "Cache-Control": "no-store" },
  );
});

/** One version. It never changes, so it can be cached for good. Works while deleted. */
documentRoutes.get("/:id/versions/:version", async (c) => {
  const documentId = c.req.param("id");
  const documents = c.var.repositories.documents;
  const requested = parseVersionNumber(c.req.param("version"));
  const found = await lookUpWithDocumentKey(
    documentId,
    c.req.header("Authorization"),
    // A number that can't be a version still authenticates the key, then gets 404.
    (id, keyHash, now) => documents.findVersion(id, keyHash, requested ?? 0, now),
    c.var.repositories.keys,
  );
  if (found === null) {
    return unauthorized();
  }
  if (!allows(found.key.permission, "read-drafts")) {
    return forbidden();
  }
  if (requested === null || requested > found.latestVersion) {
    return versionNotFound();
  }
  if (found.version === null) {
    return versionPruned();
  }
  if (found.version.deleted || found.version.body === null) {
    return versionIsDeletionMarker();
  }
  return versionResponse(requested, found.version.body, c.req.header("If-None-Match"), IMMUTABLE);
});

/** Inserts the next version over `baseVersion` and answers `201`, or `412` if someone wrote first. */
async function saveNewVersion(
  documents: DocumentRepository,
  version: { documentId: string; baseVersion: number; body: string; createdBy: string },
): Promise<Response> {
  const newVersion = nextVersion(version.baseVersion);
  const outcome = await documents.appendVersion(
    { ...version, newVersion, createdAt: new Date().toISOString() },
    MAX_VERSIONS,
  );
  if (outcome === "stale") {
    return preconditionFailed();
  }
  return new Response(null, {
    status: 201,
    headers: {
      Location: `/v1/documents/${version.documentId}/versions/${String(newVersion)}`,
      ETag: strongTag(String(newVersion)),
    },
  });
}
