import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";

declare global {
  // A namespace is the only way to extend the `Cloudflare.Env` that `wrangler types` generates.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cloudflare {
    interface Env {
      /** Test-only binding, set in vitest.config.ts. */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

// Safe to run before every test file: already-applied migrations are skipped.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
