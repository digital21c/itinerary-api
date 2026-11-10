const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** True for a UUID in the lower-case form `crypto.randomUUID()` produces. */
export function isUuid(text: string): boolean {
  return UUID.test(text);
}
