import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import app from "./index";

// Smoke tests for the tooling: the Workers runtime, the D1 binding and the migrations.
describe("test setup", () => {
  it("serves a request through Hono", async () => {
    const response = await app.request("/", {}, env);

    expect(response.status).toBe(200);
  });

  it("applies the migrations to the local D1", async () => {
    const { results } = await env.DB.prepare(
      "select name from sqlite_master where type = 'table' and name not like '\\_%' escape '\\' and name not like 'sqlite%' order by name",
    ).all<{ name: string }>();

    expect(results.map((row) => row.name)).toEqual([
      "creator_keys",
      "d1_migrations",
      "document_keys",
      "document_publications",
      "document_versions",
      "documents",
    ]);
  });

  it("enforces foreign keys", async () => {
    const insertOrphanDocument = env.DB.prepare(
      "insert into documents (id, type, created_at, created_by) values (?1, 'itinerary', ?2, ?3)",
    )
      .bind(crypto.randomUUID(), new Date().toISOString(), crypto.randomUUID())
      .run();

    await expect(insertOrphanDocument).rejects.toThrow(/FOREIGN KEY/);
  });
});
