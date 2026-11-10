import type { z } from "zod";
import { isJsonMediaType, readBodyText } from "../utils/request-body";
import { badRequest, contentTooLarge, unprocessable, unsupportedMediaType } from "./problems";

export type JsonBody<T> = { ok: true; value: T } | { ok: false; response: Response };

/**
 * Reads a JSON request body and checks it against `schema`, in order: `415` unless JSON,
 * `413` over `maxBytes`, `400` for invalid UTF-8 or JSON, `422` if it doesn't match `schema`
 * (with `invalidDetail` as the explanation).
 */
export async function readJsonBody<T>(
  request: Request,
  options: { maxBytes: number; schema: z.ZodType<T>; invalidDetail: string },
): Promise<JsonBody<T>> {
  if (!isJsonMediaType(request.headers.get("Content-Type") ?? undefined)) {
    return { ok: false, response: unsupportedMediaType() };
  }

  const text = await readBodyText(request, options.maxBytes);
  if (!text.ok) {
    return {
      ok: false,
      response:
        text.reason === "too-large"
          ? contentTooLarge(options.maxBytes)
          : badRequest("The body isn't UTF-8."),
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(text.text);
  } catch {
    return { ok: false, response: badRequest("The body isn't JSON.") };
  }

  const result = options.schema.safeParse(json);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, response: unprocessable(options.invalidDetail) };
}
