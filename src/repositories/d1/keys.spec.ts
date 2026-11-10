import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDocument, keyIdOf, publish, saveVersion } from "../../routes/test-fixtures";
import { D1KeyRepository, ISSUE_KEY_SQL } from "./keys";

const repository = () => new D1KeyRepository(env.DB);

async function managerIdsOf(documentId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "select id from document_keys where document_id = ?1 and permission = 'manager' order by id",
  )
    .bind(documentId)
    .all<{ id: string }>();
  return results.map((row) => row.id);
}

describe("D1KeyRepository: the requester must still be active", () => {
  // The route's own lookup also stops a revoked requester; these call the repository directly
  // to prove the condition inside each write holds even when that lookup passed first.
  it("refuses the second of two managers revoking each other", async () => {
    const trip = await createDocument();
    const second = crypto.randomUUID();
    await env.DB.prepare(
      `insert into document_keys (id, document_id, key_hash, permission, label, created_at)
       values (?1, ?2, ?3, 'manager', 'second', ?4)`,
    )
      .bind(second, trip.id, crypto.getRandomValues(new Uint8Array(32)), new Date().toISOString())
      .run();
    const first = await keyIdOf(trip.managerKey);
    const now = new Date();

    expect(
      await repository().revoke({ documentId: trip.id, targetId: second, requesterId: first, now }),
    ).toBe("revoked");
    expect(
      await repository().revoke({ documentId: trip.id, targetId: first, requesterId: second, now }),
    ).toBe("requester-inactive");

    const { results } = await env.DB.prepare(
      "select id from document_keys where document_id = ?1 and permission = 'manager' and revoked_at is null",
    )
      .bind(trip.id)
      .all<{ id: string }>();
    expect(results.map((row) => row.id)).toEqual([first]);
    expect(await managerIdsOf(trip.id)).toHaveLength(2);
  });

  it("refuses a revoked requester's expiry change and new key", async () => {
    const trip = await createDocument();
    const managerId = await keyIdOf(trip.managerKey);
    await env.DB.prepare("update document_keys set revoked_at = ?1 where id = ?2")
      .bind(new Date().toISOString(), managerId)
      .run();
    const now = new Date();

    expect(
      await repository().setExpiry({
        documentId: trip.id,
        targetId: await keyIdOf(trip.readerKey),
        expiresAt: "2999-01-01T00:00:00.000Z",
        requesterId: managerId,
        now,
      }),
    ).toBe("requester-inactive");
    expect(
      await repository().issue(
        {
          documentId: trip.id,
          id: crypto.randomUUID(),
          keyHash: crypto.getRandomValues(new Uint8Array(32)),
          permission: "manager",
          label: "mine now",
          createdAt: now.toISOString(),
          expiresAt: null,
        },
        managerId,
        20,
      ),
    ).toBe("requester-inactive");
  });

  it("never lets a key revoke itself, even if the route's check were skipped", async () => {
    const trip = await createDocument();
    const managerId = await keyIdOf(trip.managerKey);

    expect(
      await repository().revoke({
        documentId: trip.id,
        targetId: managerId,
        requesterId: managerId,
        now: new Date(),
      }),
    ).toBe("requester-inactive");
    const row = await env.DB.prepare("select revoked_at from document_keys where id = ?1")
      .bind(managerId)
      .first();
    expect(row).toEqual({ revoked_at: null });
  });
});

describe("D1KeyRepository.issue", () => {
  it("doesn't read the tables whose foreign keys point at document_keys", async () => {
    // The query plan lists scans of document_versions and document_publications, as SQLite's
    // foreign-key checks; they must not actually run. With many rows in both tables, an
    // insert that ran them would read far more than a handful of rows.
    for (let count = 0; count < 15; count++) {
      const trip = await createDocument();
      await saveVersion(trip.id, trip.editorKey, '"1"');
      await publish(trip.id, trip.editorKey, 2);
    }
    const trip = await createDocument();
    const now = new Date().toISOString();

    const result = await env.DB.prepare(ISSUE_KEY_SQL)
      .bind(
        crypto.randomUUID(),
        trip.id,
        crypto.getRandomValues(new Uint8Array(32)),
        "reader",
        "x",
        now,
        null,
        20,
        await keyIdOf(trip.managerKey),
      )
      .run();

    expect(result.meta.changes).toBe(1);
    expect(result.meta.rows_read).toBeLessThan(15);
  });
});
