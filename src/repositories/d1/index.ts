import type { Repositories } from "../types";
import { D1CreatorKeyRepository } from "./creator-keys";
import { D1DocumentRepository } from "./documents";

export function d1Repositories(db: D1Database): Repositories {
  return {
    creatorKeys: new D1CreatorKeyRepository(db),
    documents: new D1DocumentRepository(db),
  };
}
