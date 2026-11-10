import { type DocumentBody, parseDocumentBody } from "../models/document-body";
import { MAX_DOCUMENT_BYTES } from "../models/limits";
import { isJsonMediaType, readBodyText } from "../utils/request-body";
import { badRequest, contentTooLarge, notAnObject, unsupportedMediaType } from "./problems";

/**
 * Reads a document from the request, with every body check in order: `415` unless JSON,
 * `413` over the size limit, `400` for invalid UTF-8 or JSON, `422` unless a JSON object.
 */
export async function readDocumentBody(
  request: Request,
): Promise<{ ok: true; body: DocumentBody } | { ok: false; response: Response }> {
  if (!isJsonMediaType(request.headers.get("Content-Type") ?? undefined)) {
    return { ok: false, response: unsupportedMediaType() };
  }

  const text = await readBodyText(request, MAX_DOCUMENT_BYTES);
  if (!text.ok) {
    return {
      ok: false,
      response:
        text.reason === "too-large" ? contentTooLarge() : badRequest("The body isn't UTF-8."),
    };
  }

  const parsed = parseDocumentBody(text.text);
  if (!parsed.ok) {
    return {
      ok: false,
      response:
        parsed.reason === "invalid-json" ? badRequest("The body isn't JSON.") : notAnObject(),
    };
  }
  return { ok: true, body: parsed.body };
}
