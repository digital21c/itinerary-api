import type { ActiveCreatorKey, Repositories } from "./repositories/types";

/** Hono's typing for this app: the Worker bindings and the per-request context variables. */
export interface AppEnv {
  Bindings: Env;
  Variables: {
    repositories: Repositories;
    /** Set by `requireCreatorKey`. */
    creatorKey: ActiveCreatorKey;
  };
}
