import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["node_modules/", ".wrangler/", "dist/", "worker-configuration.d.ts"] },
  js.configs.recommended,
  // Type-aware rules catch unhandled promises, which matter with D1's async API.
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  { files: ["eslint.config.js"], extends: [tseslint.configs.disableTypeChecked] },
  // Last, so formatting is left entirely to Prettier.
  prettier,
);
