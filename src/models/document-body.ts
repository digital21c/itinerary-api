import { z } from "zod";

/**
 * The interim body rule, until the itinerary schema is designed: any JSON object, not an
 * array or a single value. Size is checked before parsing, in the route.
 */
export const documentBodySchema = z.record(z.string(), z.unknown());

export type DocumentBody = z.infer<typeof documentBodySchema>;
