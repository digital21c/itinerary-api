/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import spec from "../openapi.yaml?raw";
import app from "./index";

/**
 * The spec is written by hand, so this keeps it honest: every route the app serves must be
 * in openapi.yaml, and every operation in openapi.yaml must be served.
 *
 * It reads the YAML by indentation instead of with a parser (no dependency needed). Prettier
 * keeps that layout fixed: paths at two spaces, methods at four.
 */
const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "head", "options"] as const;

function specOperations(yaml: string): string[] {
  const operations: string[] = [];
  let inPaths = false;
  let path: string | null = null;

  for (const line of yaml.split("\n")) {
    if (/^\S/.test(line)) {
      inPaths = line === "paths:";
      path = null;
      continue;
    }
    if (!inPaths) {
      continue;
    }
    const pathMatch = /^ {2}(\/\S*):\s*$/.exec(line);
    if (pathMatch?.[1] !== undefined) {
      path = pathMatch[1];
      continue;
    }
    const methodMatch = /^ {4}([a-z]+):\s*$/.exec(line);
    const method = methodMatch?.[1];
    if (
      path !== null &&
      method !== undefined &&
      (HTTP_METHODS as readonly string[]).includes(method)
    ) {
      operations.push(`${method.toUpperCase()} ${path}`);
    }
  }
  return operations.sort();
}

function appOperations(): string[] {
  const operations = app.routes
    // Middleware registered with app.use() shows up as method ALL.
    .filter((route) => route.method !== "ALL")
    // Hono writes path parameters as :id; OpenAPI as {id}.
    .map((route) => `${route.method} ${route.path.replace(/:(\w+)/g, "{$1}")}`);
  return [...new Set(operations)].sort();
}

describe("openapi.yaml", () => {
  it("can be read", () => {
    expect(specOperations(spec).length).toBeGreaterThan(0);
  });

  it("describes exactly the operations the app serves", () => {
    expect(specOperations(spec)).toEqual(appOperations());
  });
});
