import { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { unauthorized } from "../auth/bearer";
import { lookUpWithDocumentKey } from "../auth/document-key";
import { allows } from "../models/permissions";
import { MAX_PUBLISH_REQUEST_BYTES, publishRequestSchema } from "../models/publication";
import { readJsonBody } from "./json-body";
import { documentGone, forbidden, notPublishable, nothingPublished } from "./problems";
import { versionResponse } from "./version-response";

/**
 * `/v1/documents/{id}/published`: the version travellers see. It is a setting that `PUT`
 * replaces and `DELETE` removes; saving a version never changes it.
 */
export const publicationRoutes = new Hono<AppEnv>();

/** What travellers see. Any document key: reader, editor or manager. */
publicationRoutes.get("/:id/published", async (c) => {
  const publications = c.var.repositories.publications;
  const found = await lookUpWithDocumentKey(
    c.req.param("id"),
    c.req.header("Authorization"),
    (documentId, keyHash, now) => publications.findPublished(documentId, keyHash, now),
  );
  if (found === null) {
    return unauthorized();
  }
  if (!allows(found.key.permission, "read-published")) {
    return forbidden();
  }
  if (found.published === null) {
    return nothingPublished();
  }
  const { version, body } = found.published;
  return versionResponse(version, body, c.req.header("If-None-Match"));
});

/**
 * Publish one specific version: `{ "version": n }`. Editor or manager. Idempotent, and needs
 * no If-Match: it states the whole intended result, so there is nothing to overwrite.
 */
publicationRoutes.put("/:id/published", async (c) => {
  const documentId = c.req.param("id");
  const documents = c.var.repositories.documents;
  const found = await lookUpWithDocumentKey(
    documentId,
    c.req.header("Authorization"),
    (id, keyHash, now) => documents.findLatestHead(id, keyHash, now),
  );
  if (found === null) {
    return unauthorized();
  }
  if (!allows(found.key.permission, "publish")) {
    return forbidden();
  }
  if (found.latest.deleted) {
    return documentGone();
  }

  const read = await readJsonBody(c.req.raw, {
    maxBytes: MAX_PUBLISH_REQUEST_BYTES,
    schema: publishRequestSchema,
    invalidDetail: 'The body must be exactly { "version": <a positive integer> }.',
  });
  if (!read.ok) {
    return read.response;
  }

  // The statement itself re-checks the version and that the document isn't deleted, so a
  // publish racing a delete or a prune can't publish something it shouldn't.
  const outcome = await c.var.repositories.publications.publish({
    documentId,
    version: read.value.version,
    publishedAt: new Date().toISOString(),
    publishedBy: found.key.keyId,
  });
  if (outcome === "not-publishable") {
    return notPublishable();
  }
  return new Response(null, { status: 204 });
});

/** Unpublish, so readers get 404. Editor or manager. Idempotent: 204 even if nothing was published. */
publicationRoutes.delete("/:id/published", async (c) => {
  const documentId = c.req.param("id");
  const documents = c.var.repositories.documents;
  const found = await lookUpWithDocumentKey(
    documentId,
    c.req.header("Authorization"),
    (id, keyHash, now) => documents.findLatestHead(id, keyHash, now),
  );
  if (found === null) {
    return unauthorized();
  }
  if (!allows(found.key.permission, "publish")) {
    return forbidden();
  }

  await c.var.repositories.publications.unpublish(documentId);
  return new Response(null, { status: 204 });
});
