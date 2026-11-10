import { type DocumentBody, documentBodySchema } from "../models/document-body";
import { MAX_DOCUMENT_BYTES } from "../models/limits";
import { type JsonBody, readJsonBody } from "./json-body";

/** Reads a document from the request: `415`, `413`, `400`, or `422` unless a JSON object. */
export function readDocumentBody(request: Request): Promise<JsonBody<DocumentBody>> {
  return readJsonBody(request, {
    maxBytes: MAX_DOCUMENT_BYTES,
    schema: documentBodySchema,
    invalidDetail: "A document must be a JSON object.",
  });
}
