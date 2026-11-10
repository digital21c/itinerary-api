import type { Repositories } from "../types";
import { D1CreatorKeyRepository } from "./creator-keys";
import { D1DocumentRepository } from "./documents";
import { D1KeyRepository } from "./keys";
import { D1PublicationRepository } from "./publications";

export function d1Repositories(db: D1Database): Repositories {
  return {
    creatorKeys: new D1CreatorKeyRepository(db),
    documents: new D1DocumentRepository(db),
    publications: new D1PublicationRepository(db),
    keys: new D1KeyRepository(db),
  };
}
