import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hashKey } from "../auth/keys";
import { MAX_KEYS_PER_DOCUMENT } from "../models/limits";
import {
  authenticationFailures,
  type CreatedDocument,
  createDocument,
  getLatest,
  getPublished,
  issued,
  issueKey,
  keyIdOf,
  keysOf,
  listKeys,
  markDeleted,
  request,
  revokeKey,
  setKeyColumn,
  setKeyExpiry,
  storedKeyRow,
  summaryOf,
} from "./test-fixtures";

const PAST = "2026-01-01T00:00:00.000Z";

/** Statuses of every route here for a key that can't manage keys. */
async function keyRouteStatuses(trip: CreatedDocument, key: string): Promise<number[]> {
  const editorKeyId = await keyIdOf(trip.editorKey);
  return Promise.all([
    listKeys(trip.id, key),
    issueKey(trip.id, key, { permission: "reader", label: "x" }),
    setKeyExpiry(trip.id, key, editorKeyId, { expiresAt: null }),
    revokeKey(trip.id, key, editorKeyId),
  ]).then((responses) => responses.map((response) => response.status));
}

describe("key management: who may do it", () => {
  it.each(["editor", "reader"] as const)(
    "refuses a %s key with 403 on every route",
    async (kind) => {
      const trip = await createDocument();

      expect(await keyRouteStatuses(trip, trip[`${kind}Key`])).toEqual([403, 403, 403, 403]);
      expect((await storedKeyRow(trip.editorKey))?.revoked_at).toBeNull();
    },
  );

  it("refuses another trip's manager key with 401 on every route", async () => {
    const [trip, other] = [await createDocument(), await createDocument()];

    expect(await keyRouteStatuses(trip, other.managerKey)).toEqual([401, 401, 401, 401]);
    expect((await storedKeyRow(trip.editorKey))?.revoked_at).toBeNull();
  });

  it("gives every authentication failure the same 401 as the other endpoints", async () => {
    const [trip, other] = [await createDocument(), await createDocument()];
    const baseline = await (await getLatest(trip.id, null)).text();

    for (const [description, documentId, key] of await authenticationFailures(trip, other)) {
      const response = await listKeys(documentId, key);
      const text = await response.text();

      expect.soft(response.status, description).toBe(401);
      expect.soft(text, description).toBe(baseline);
      if (key !== null) {
        expect.soft(text.includes(key), description).toBe(false);
      }
    }
  });
});

describe("GET /v1/documents/{id}/keys", () => {
  it("lists a new trip's three labelled keys, marking the one asking", async () => {
    const trip = await createDocument();

    const response = await listKeys(trip.id, trip.managerKey);
    const { keys } = await response.json<{ keys: { label: string; isCurrentKey: boolean }[] }>();

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(keys.map((key) => [key.label, key.isCurrentKey]).sort()).toEqual([
      ["Initial editor key", false],
      ["Initial manager key", true],
      ["Initial reader key", false],
    ]);
  });

  it("never contains a key or a key's hash", async () => {
    const trip = await createDocument();

    const text = await (await listKeys(trip.id, trip.managerKey)).text();

    for (const key of [trip.managerKey, trip.editorKey, trip.readerKey]) {
      expect(text.includes(key.slice(3))).toBe(false);
      const hash = await hashKey(key);
      expect(text.toLowerCase().includes(hash.toHex())).toBe(false);
      expect(text.includes(hash.toBase64())).toBe(false);
    }
  });

  it("shows each key's status, and its expiry as the last valid day", async () => {
    const trip = await createDocument();
    const expiring = await issued(trip.id, trip.managerKey, {
      permission: "reader",
      expiresAt: "2999-04-30",
    });
    const revoked = await issued(trip.id, trip.managerKey, { permission: "editor" });
    await revokeKey(trip.id, trip.managerKey, revoked.id);
    await setKeyColumn(trip.readerKey, "expires_at", PAST);

    const byId = new Map((await keysOf(trip.id, trip.managerKey)).map((key) => [key.id, key]));

    expect(byId.get(expiring.id)).toMatchObject({ status: "active", expiresAt: "2999-04-30" });
    expect(byId.get(revoked.id)?.status).toBe("revoked");
    expect(byId.get(revoked.id)?.revokedAt).not.toBeNull();
    expect(byId.get(await keyIdOf(trip.readerKey))?.status).toBe("expired");
  });
});

describe("POST /v1/documents/{id}/keys", () => {
  it("issues a key that is shown once, listed, and not cached", async () => {
    const trip = await createDocument();

    const response = await issueKey(trip.id, trip.managerKey, {
      permission: "editor",
      label: "  Kyoto desk – laptop ",
      expiresAt: "2999-04-30",
    });
    const body = await response.json<{ id: string; key: string }>();

    expect(response.status).toBe(201);
    expect(response.headers.get("Location")).toBe(`/v1/documents/${trip.id}/keys/${body.id}`);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({
      id: body.id,
      key: body.key,
      permission: "editor",
      label: "Kyoto desk – laptop",
      expiresAt: "2999-04-30",
    });
    expect(body.key).toMatch(/^ek_[A-Za-z0-9_-]{43}$/);
    expect(await summaryOf(trip.id, trip.managerKey, body.key)).toMatchObject({
      label: "Kyoto desk – laptop",
      status: "active",
    });
  });

  it("issues keys that can do exactly what their permission allows", async () => {
    const trip = await createDocument();
    const reader = await issued(trip.id, trip.managerKey, { permission: "reader" });
    const editor = await issued(trip.id, trip.managerKey, { permission: "editor" });
    const manager = await issued(trip.id, trip.managerKey, { permission: "manager" });

    expect((await getPublished(trip.id, reader.key)).status).toBe(404); // works; nothing published
    expect((await getLatest(trip.id, reader.key)).status).toBe(403);
    expect((await getLatest(trip.id, editor.key)).status).toBe(200);
    expect((await listKeys(trip.id, editor.key)).status).toBe(403);
    expect((await listKeys(trip.id, manager.key)).status).toBe(200);
  });

  it("issues keys that work only on their own trip", async () => {
    const [trip, other] = [await createDocument(), await createDocument()];
    const editor = await issued(trip.id, trip.managerKey, { permission: "editor" });

    expect((await getLatest(other.id, editor.key)).status).toBe(401);
  });

  it.each([
    ["an expiry on a manager key", { permission: "manager", label: "x", expiresAt: "2999-01-01" }],
    ["a past expiry", { permission: "reader", label: "x", expiresAt: "2026-01-01" }],
    ["an impossible date", { permission: "reader", label: "x", expiresAt: "2027-02-30" }],
    ["a date and time", { permission: "reader", label: "x", expiresAt: "2999-01-01T00:00:00Z" }],
    ["no label", { permission: "reader" }],
    ["an empty label", { permission: "reader", label: "  " }],
    ["a label over 100 characters", { permission: "reader", label: "x".repeat(101) }],
    ["a creator permission", { permission: "creator", label: "x" }],
    ["an extra field", { permission: "reader", label: "x", key: "rk_mine" }],
  ])("refuses %s with 422", async (_description, body) => {
    const trip = await createDocument();

    const response = await issueKey(trip.id, trip.managerKey, body);

    expect(response.status).toBe(422);
    expect(await keysOf(trip.id, trip.managerKey)).toHaveLength(3);
  });

  it.each([
    ["text/plain", '{"permission":"reader","label":"x"}', { "Content-Type": "text/plain" }, 415],
    [
      "over 1,000 bytes",
      JSON.stringify({ permission: "reader", label: "x".repeat(1000) }),
      {},
      413,
    ],
    ["invalid JSON", "{", {}, 400],
  ])("checks the body: %s", async (_description, body, headers, status) => {
    const trip = await createDocument();

    expect((await issueKey(trip.id, trip.managerKey, body, headers)).status).toBe(status);
  });

  it(`stops at ${String(MAX_KEYS_PER_DOCUMENT)} unrevoked keys, and revoking one frees a slot`, async () => {
    const trip = await createDocument();
    const extra: string[] = [];
    for (let count = 3; count < MAX_KEYS_PER_DOCUMENT; count++) {
      extra.push((await issued(trip.id, trip.managerKey, { permission: "reader" })).id);
    }

    const overCap = await issueKey(trip.id, trip.managerKey, { permission: "reader", label: "x" });
    expect(overCap.status).toBe(409);
    expect(await overCap.json()).toMatchObject({ type: "/problems/key-limit-reached" });

    await revokeKey(trip.id, trip.managerKey, extra[0] ?? "");
    await issued(trip.id, trip.managerKey, { permission: "reader" });
  });

  it("counts expired keys towards the cap, since they can be reactivated", async () => {
    const trip = await createDocument();
    for (let count = 3; count < MAX_KEYS_PER_DOCUMENT; count++) {
      await issued(trip.id, trip.managerKey, { permission: "reader" });
    }
    await setKeyColumn(trip.readerKey, "expires_at", PAST);

    const response = await issueKey(trip.id, trip.managerKey, { permission: "reader", label: "x" });

    expect(response.status).toBe(409);
  });

  it("refuses to issue a key on a deleted trip with 410", async () => {
    const trip = await createDocument();
    await markDeleted(trip.id, 2);

    const response = await issueKey(trip.id, trip.managerKey, { permission: "reader", label: "x" });

    expect(response.status).toBe(410);
  });
});

describe("PATCH /v1/documents/{id}/keys/{keyId}", () => {
  it("sets an expiry, shown as the last valid day, and the key keeps working", async () => {
    const trip = await createDocument();
    const readerId = await keyIdOf(trip.readerKey);

    const response = await setKeyExpiry(trip.id, trip.managerKey, readerId, {
      expiresAt: "2999-06-30",
    });

    expect(response.status).toBe(204);
    expect((await storedKeyRow(trip.readerKey))?.expires_at).toBe("2999-07-01T00:00:00.000Z");
    expect((await summaryOf(trip.id, trip.managerKey, trip.readerKey)).expiresAt).toBe(
      "2999-06-30",
    );
    expect((await getPublished(trip.id, trip.readerKey)).status).toBe(404);
  });

  it("reactivates an expired key when its expiry is extended", async () => {
    const trip = await createDocument();
    await setKeyColumn(trip.editorKey, "expires_at", PAST);
    expect((await getLatest(trip.id, trip.editorKey)).status).toBe(401);

    const response = await setKeyExpiry(trip.id, trip.managerKey, await keyIdOf(trip.editorKey), {
      expiresAt: "2999-01-01",
    });

    expect(response.status).toBe(204);
    expect((await getLatest(trip.id, trip.editorKey)).status).toBe(200);
  });

  it("removes an expiry with null", async () => {
    const trip = await createDocument();
    const readerId = await keyIdOf(trip.readerKey);
    await setKeyExpiry(trip.id, trip.managerKey, readerId, { expiresAt: "2999-01-01" });

    expect(
      (await setKeyExpiry(trip.id, trip.managerKey, readerId, { expiresAt: null })).status,
    ).toBe(204);
    expect((await storedKeyRow(trip.readerKey))?.expires_at).toBeNull();
  });

  it("never reactivates a revoked key", async () => {
    const trip = await createDocument();
    const editorId = await keyIdOf(trip.editorKey);
    await revokeKey(trip.id, trip.managerKey, editorId);

    const response = await setKeyExpiry(trip.id, trip.managerKey, editorId, {
      expiresAt: "2999-01-01",
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ type: "/problems/key-revoked" });
    expect((await getLatest(trip.id, trip.editorKey)).status).toBe(401);
  });

  it("refuses an expiry on a manager key with 422, but accepts null", async () => {
    const trip = await createDocument();
    const second = await issued(trip.id, trip.managerKey, { permission: "manager" });

    expect(
      (await setKeyExpiry(trip.id, trip.managerKey, second.id, { expiresAt: "2999-01-01" })).status,
    ).toBe(422);
    expect(
      (await setKeyExpiry(trip.id, trip.managerKey, second.id, { expiresAt: null })).status,
    ).toBe(204);
  });

  it.each([
    ["a past date", { expiresAt: "2026-01-01" }],
    ["no expiresAt", {}],
    ["a number", { expiresAt: 20270101 }],
    ["an extra field", { expiresAt: null, label: "renamed" }],
  ])("refuses %s with 422", async (_description, body) => {
    const trip = await createDocument();

    const response = await setKeyExpiry(
      trip.id,
      trip.managerKey,
      await keyIdOf(trip.readerKey),
      body,
    );

    expect(response.status).toBe(422);
  });

  it("accepts application/json as well as merge-patch, and refuses other media types", async () => {
    const trip = await createDocument();
    const readerId = await keyIdOf(trip.readerKey);
    const body = { expiresAt: "2999-01-01" };

    expect(
      (await setKeyExpiry(trip.id, trip.managerKey, readerId, body, "application/json")).status,
    ).toBe(204);
    expect(
      (await setKeyExpiry(trip.id, trip.managerKey, readerId, body, "text/plain")).status,
    ).toBe(415);
  });

  it.each([
    ["another trip's key", "other"],
    ["a key ID that doesn't exist", "missing"],
    ["a key ID that isn't a UUID", "not-a-uuid"],
  ])("answers 404 for %s, touching nothing", async (_description, which) => {
    const [trip, other] = [await createDocument(), await createDocument()];
    const keyId =
      which === "other"
        ? await keyIdOf(other.readerKey)
        : which === "missing"
          ? crypto.randomUUID()
          : "not-a-uuid";

    const response = await setKeyExpiry(trip.id, trip.managerKey, keyId, {
      expiresAt: "2999-01-01",
    });

    expect(response.status).toBe(404);
    expect((await storedKeyRow(other.readerKey))?.expires_at).toBeNull();
  });
});

describe("DELETE /v1/documents/{id}/keys/{keyId}", () => {
  it("revokes a key, which stops working at once, everywhere", async () => {
    const trip = await createDocument();

    const response = await revokeKey(trip.id, trip.managerKey, await keyIdOf(trip.editorKey));

    expect(response.status).toBe(204);
    expect((await getLatest(trip.id, trip.editorKey)).status).toBe(401);
    expect((await getPublished(trip.id, trip.editorKey)).status).toBe(401);
    expect((await summaryOf(trip.id, trip.managerKey, trip.editorKey)).status).toBe("revoked");
  });

  it("is safe to repeat, keeping the original revocation time", async () => {
    const trip = await createDocument();
    const editorId = await keyIdOf(trip.editorKey);
    await revokeKey(trip.id, trip.managerKey, editorId);
    const first = (await storedKeyRow(trip.editorKey))?.revoked_at;

    expect((await revokeKey(trip.id, trip.managerKey, editorId)).status).toBe(204);
    expect((await storedKeyRow(trip.editorKey))?.revoked_at).toBe(first);
  });

  it("won't let a manager key revoke itself", async () => {
    const trip = await createDocument();

    const response = await revokeKey(trip.id, trip.managerKey, await keyIdOf(trip.managerKey));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ type: "/problems/cannot-revoke-own-key" });
    expect((await listKeys(trip.id, trip.managerKey)).status).toBe(200);
  });

  it("replaces a manager key: issue a new one, then revoke the old one with it", async () => {
    const trip = await createDocument();
    const replacement = await issued(trip.id, trip.managerKey, { permission: "manager" });

    expect((await revokeKey(trip.id, replacement.key, await keyIdOf(trip.managerKey))).status).toBe(
      204,
    );
    expect((await listKeys(trip.id, trip.managerKey)).status).toBe(401);
    expect((await listKeys(trip.id, replacement.key)).status).toBe(200);
  });

  it("answers 404 for another trip's key, which keeps working", async () => {
    const [trip, other] = [await createDocument(), await createDocument()];

    const response = await revokeKey(trip.id, trip.managerKey, await keyIdOf(other.editorKey));

    expect(response.status).toBe(404);
    expect((await getLatest(other.id, other.editorKey)).status).toBe(200);
  });

  it("allows revoking keys on a deleted trip", async () => {
    const trip = await createDocument();
    await markDeleted(trip.id, 2);

    expect((await revokeKey(trip.id, trip.managerKey, await keyIdOf(trip.readerKey))).status).toBe(
      204,
    );
  });

  it("leaves exactly one working manager when two managers revoke each other at once", async () => {
    const trip = await createDocument();
    const second = await issued(trip.id, trip.managerKey, { permission: "manager" });
    const firstId = await keyIdOf(trip.managerKey);

    const responses = await Promise.all([
      revokeKey(trip.id, trip.managerKey, second.id),
      revokeKey(trip.id, second.key, firstId),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([204, 401]);
    const managers = (
      await env.DB.prepare(
        `select count(*) as active from document_keys
       where document_id = ?1 and permission = 'manager' and revoked_at is null`,
      )
        .bind(trip.id)
        .first<{ active: number }>()
    )?.active;
    expect(managers).toBe(1);
  });
});

describe("last_used_at", () => {
  it("is empty until a key is used, then set", async () => {
    const trip = await createDocument();
    expect((await storedKeyRow(trip.readerKey))?.last_used_at).toBeNull();
    const before = new Date().toISOString();

    await getPublished(trip.id, trip.readerKey);

    expect(((await storedKeyRow(trip.readerKey))?.last_used_at ?? "") >= before).toBe(true);
  });

  it("isn't rewritten within the hour", async () => {
    const trip = await createDocument();
    await getPublished(trip.id, trip.readerKey);
    const first = (await storedKeyRow(trip.readerKey))?.last_used_at;

    await new Promise((resolve) => setTimeout(resolve, 5));
    await getPublished(trip.id, trip.readerKey);

    expect((await storedKeyRow(trip.readerKey))?.last_used_at).toBe(first);
  });

  it("is rewritten once it is over an hour old", async () => {
    const trip = await createDocument();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare("update document_keys set last_used_at = ?1 where key_hash = ?2")
      .bind(twoHoursAgo, await hashKey(trip.readerKey))
      .run();

    await getPublished(trip.id, trip.readerKey);

    expect(((await storedKeyRow(trip.readerKey))?.last_used_at ?? "") > twoHoursAgo).toBe(true);
  });

  it("counts a request that the key authenticated but wasn't allowed (403)", async () => {
    const trip = await createDocument();

    expect((await getLatest(trip.id, trip.readerKey)).status).toBe(403);

    expect((await storedKeyRow(trip.readerKey))?.last_used_at).not.toBeNull();
  });

  it("is shown in the key list", async () => {
    const trip = await createDocument();
    await getPublished(trip.id, trip.readerKey);

    const summary = await summaryOf(trip.id, trip.managerKey, trip.readerKey);

    expect(summary.lastUsedAt).toBe((await storedKeyRow(trip.readerKey))?.last_used_at);
  });

  it("isn't set by a request that fails authentication", async () => {
    const trip = await createDocument();
    const other = await createDocument();

    await request(`/v1/documents/${other.id}`, {
      headers: { Authorization: `Bearer ${trip.editorKey}` },
    });

    expect((await storedKeyRow(trip.editorKey))?.last_used_at).toBeNull();
  });
});
