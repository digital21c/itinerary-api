import { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { requireCreatorKey } from "../auth/creator-key";
import { parseDocumentBody } from "../models/document-body";
import { MAX_DOCUMENT_BYTES, MAX_DOCUMENTS_PER_CREATOR_KEY } from "../models/limits";
import { planNewDocument } from "../models/new-document";
import { problemResponse } from "../utils/problem";
import { isJsonMediaType, readBodyText } from "../utils/request-body";

/** Routes under /v1/documents. */
export const documentRoutes = new Hono<AppEnv>();

documentRoutes.post("/", requireCreatorKey, async (c) => {
  if (!isJsonMediaType(c.req.header("Content-Type"))) {
    return problemResponse({
      status: 415,
      title: "Unsupported Media Type",
      detail: "The body must be application/json.",
    });
  }

  const bodyText = await readBodyText(c.req.raw, MAX_DOCUMENT_BYTES);
  if (!bodyText.ok) {
    return bodyText.reason === "too-large"
      ? problemResponse({
          status: 413,
          title: "Content Too Large",
          detail: `A document can be at most ${String(MAX_DOCUMENT_BYTES)} bytes.`,
        })
      : problemResponse({ status: 400, title: "Bad Request", detail: "The body isn't UTF-8." });
  }

  const parsed = parseDocumentBody(bodyText.text);
  if (!parsed.ok) {
    return parsed.reason === "invalid-json"
      ? problemResponse({ status: 400, title: "Bad Request", detail: "The body isn't JSON." })
      : problemResponse({
          status: 422,
          title: "Unprocessable Content",
          detail: "A document must be a JSON object.",
        });
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
    body: parsed.body,
    creatorKeyId: creatorKey.id,
    now: new Date(),
  });
  await c.var.repositories.documents.create(document);

  // The keys are in this response only, so nothing may cache it.
  return c.json({ id: document.id, ...issuedKeys }, 201, {
    Location: `/v1/documents/${document.id}`,
    ETag: '"1"',
    "Cache-Control": "no-store",
  });
});
