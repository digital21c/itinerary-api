/**
 * Reading request bodies safely: media type, a byte limit enforced while reading, and strict
 * UTF-8 decoding.
 */

/** True for `application/json`, with or without parameters such as `charset=utf-8`. */
export function isJsonMediaType(contentType: string | undefined): boolean {
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

export type BodyText = { ok: true; text: string } | { ok: false; reason: "too-large" | "not-utf8" };

/**
 * The body as text, or why it can't be read. The limit is checked against `Content-Length`
 * first, so an honest oversized request is refused without reading it, and then against the
 * bytes actually received, so a missing or false `Content-Length` doesn't get past it.
 */
export async function readBodyText(request: Request, maxBytes: number): Promise<BodyText> {
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (declaredLength > maxBytes) {
    return { ok: false, reason: "too-large" };
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  if (request.body !== null) {
    // The Workers types leave request body chunks as `any`; they are bytes.
    const reader = (request.body as ReadableStream<Uint8Array>).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: "too-large" };
      }
      chunks.push(value);
    }
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
    return { ok: true, text: decoder.decode(bytes) };
  } catch {
    return { ok: false, reason: "not-utf8" };
  }
}
