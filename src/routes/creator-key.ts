import { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { requireCreatorKey } from "../auth/creator-key";

/**
 * `GET /v1/creator-key`: checks a creator key without side effects, so a client can verify a
 * creator link before saving the key. `204` if the key is active, the usual `401` otherwise.
 * It creates nothing and doesn't record the key as used.
 */
export const creatorKeyRoutes = new Hono<AppEnv>();

creatorKeyRoutes.get("/", requireCreatorKey, () => {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
});
