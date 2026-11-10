import { z } from "zod";

/** The body of `PUT …/published`: the version to publish, and nothing else. */
export const publishRequestSchema = z.strictObject({
  version: z.int().positive(),
});

export type PublishRequest = z.infer<typeof publishRequestSchema>;

/** A publish request is tiny; anything bigger is not one. */
export const MAX_PUBLISH_REQUEST_BYTES = 1_000;
