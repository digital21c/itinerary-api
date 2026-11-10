import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Tests run inside the real Workers runtime (workerd) with a local D1 built from
// wrangler.jsonc. Each test file gets its own isolated storage.
export default defineConfig(async () => {
  // Read in Node, then handed to the Worker as a binding so the setup file can apply them.
  const migrations = await readD1Migrations("./migrations");

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      }),
    ],
    test: {
      include: ["src/**/*.spec.ts"],
      setupFiles: ["./vitest.setup.ts"],
    },
  };
});
