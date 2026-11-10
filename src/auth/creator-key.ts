import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../app-env";
import { bearerToken, unauthorized } from "./bearer";
import { hashKey, recogniseKey } from "./keys";

/**
 * Lets the request through only with an active creator key, and records it as `creatorKey`.
 * A document key counts as unknown here, so it gets the same `401`.
 */
export const requireCreatorKey = createMiddleware<AppEnv>(async (c, next) => {
  const key = bearerToken(c.req.header("Authorization"));
  // Checking the shape first rejects garbage and document keys without a database query.
  if (key === null || recogniseKey(key) !== "creator") {
    return unauthorized();
  }

  const creatorKey = await c.var.repositories.creatorKeys.findActive(
    await hashKey(key),
    new Date(),
  );
  if (creatorKey === null) {
    return unauthorized();
  }

  c.set("creatorKey", creatorKey);
  await next();
  return undefined;
});
