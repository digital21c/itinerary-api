import { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { unauthorized } from "../auth/bearer";
import { requireCreatorKey } from "../auth/creator-key";
import { documentKeyFrom } from "../auth/document-key";
import { hashKey } from "../auth/keys";
import { MAX_DOCUMENTS_PER_CREATOR_KEY, MAX_VERSIONS } from "../models/limits";
import { planNewDocument } from "../models/new-document";
import { allows } from "../models/permissions";
import { nextVersion, parseVersionNumber } from "../models/versions";
import { noneMatchMatches, singleStrongTag, strongTag } from "../utils/entity-tags";
import { problemResponse } from "../utils/problem";
import { isUuid } from "../utils/uuid";
import { readDocumentBody } from "./document-body";
import {
  documentGone,
  forbidden,
  malformedIfMatch,
  preconditionFailed,
  preconditionRequired,
} from "./problems";

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
    body: read.body,
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
  const documentId = c.req.param("id");
  const key = documentKeyFrom(c.req.header("Authorization"));
  // An ID that can't exist gets the same 401 as one that doesn't, without a query.
  if (key === null || !isUuid(documentId)) {
    return unauthorized();
  }

  const found = await c.var.repositories.documents.findLatest(
    documentId,
    await hashKey(key),
    new Date(),
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

  // The client may keep a copy, but must revalidate it (If-None-Match) before reusing it.
  const headers = { ETag: strongTag(String(version)), "Cache-Control": "private, no-cache" };
  if (noneMatchMatches(c.req.header("If-None-Match"), String(version))) {
    return new Response(null, { status: 304, headers });
  }
  // Sent exactly as stored, so a read never parses JSON.
  return new Response(body, {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json" },
  });
});

/** Save a new full version. Requires an editor or manager key and If-Match. */
documentRoutes.post("/:id/versions", async (c) => {
  const documentId = c.req.param("id");
  const key = documentKeyFrom(c.req.header("Authorization"));
  if (key === null || !isUuid(documentId)) {
    return unauthorized();
  }

  const found = await c.var.repositories.documents.findLatestHead(
    documentId,
    await hashKey(key),
    new Date(),
  );
  if (found === null) {
    return unauthorized();
  }
  if (!allows(found.key.permission, "write")) {
    return forbidden();
  }

  // Preconditions come before the body is read (RFC 9110 §13.2.1).
  const ifMatch = c.req.header("If-Match");
  if (ifMatch === undefined) {
    return preconditionRequired();
  }
  const tag = singleStrongTag(ifMatch);
  const baseVersion = tag === null ? null : parseVersionNumber(tag);
  if (baseVersion === null) {
    return malformedIfMatch();
  }
  if (found.latest.deleted) {
    return documentGone();
  }
  // A shortcut for the common case. The insert below repeats this check atomically, which
  // is what actually stops a race.
  if (baseVersion !== found.latest.version) {
    return preconditionFailed();
  }

  const read = await readDocumentBody(c.req.raw);
  if (!read.ok) {
    return read.response;
  }

  const newVersion = nextVersion(baseVersion);
  const outcome = await c.var.repositories.documents.appendVersion(
    {
      documentId,
      baseVersion,
      newVersion,
      body: JSON.stringify(read.body),
      createdAt: new Date().toISOString(),
      createdBy: found.key.keyId,
    },
    MAX_VERSIONS,
  );
  if (outcome === "stale") {
    return preconditionFailed();
  }

  return new Response(null, {
    status: 201,
    headers: {
      Location: `/v1/documents/${documentId}/versions/${String(newVersion)}`,
      ETag: strongTag(String(newVersion)),
    },
  });
});
