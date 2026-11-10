import { z } from "zod";

/**
 * The interim body rule, until the itinerary schema is designed: any JSON object, not an
 * array or a single value. Size is checked before parsing, in the route.
 */
export const documentBodySchema = z.record(z.string(), z.unknown());

export type DocumentBody = z.infer<typeof documentBodySchema>;

export type ParsedDocumentBody =
  { ok: true; body: DocumentBody } | { ok: false; reason: "invalid-json" | "not-an-object" };

export function parseDocumentBody(text: string): ParsedDocumentBody {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid-json" };
  }

  const result = documentBodySchema.safeParse(json);
  return result.success ? { ok: true, body: result.data } : { ok: false, reason: "not-an-object" };
}
