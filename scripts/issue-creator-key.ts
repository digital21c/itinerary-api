/**
 * Issues a creator key: generates it here, inserts only its hash into D1 through Wrangler,
 * then prints the key once. It can't be retrieved later.
 *
 *   node scripts/issue-creator-key.ts --local --label "my laptop"
 *   node scripts/issue-creator-key.ts --remote --label "my laptop" --expires-at 2027-12-31
 *
 * The key goes to stdout and everything else to stderr, so it can be piped straight into a
 * password manager. Never paste it into a file in the repository.
 */
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { generateKey, hashKey } from "../src/auth/keys.ts";
import { insertCreatorKeySql, parseExpiresAt, parseLabel } from "./creator-keys.ts";

const DATABASE_NAME = "itinerary";

const USAGE =
  "Usage: node scripts/issue-creator-key.ts (--local | --remote) --label <text> [--expires-at <ISO-8601>]";

interface Options {
  target: "--local" | "--remote";
  label: string;
  expiresAt: string | null;
}

function readOptions(now: Date): Options {
  const { values } = parseArgs({
    options: {
      local: { type: "boolean", default: false },
      remote: { type: "boolean", default: false },
      label: { type: "string" },
      "expires-at": { type: "string" },
    },
    strict: true,
  });

  // No default database: issuing a key on the wrong one must be a deliberate choice.
  if (values.local === values.remote) {
    throw new Error("Choose exactly one of --local or --remote.");
  }
  if (values.label === undefined) {
    throw new Error("A --label is required, so the key can be recognised and revoked later.");
  }
  const rawExpiresAt = values["expires-at"];

  return {
    target: values.remote ? "--remote" : "--local",
    label: parseLabel(values.label),
    expiresAt: rawExpiresAt === undefined ? null : parseExpiresAt(rawExpiresAt, now),
  };
}

async function main(): Promise<void> {
  const now = new Date();
  const options = readOptions(now);

  const id = crypto.randomUUID();
  const key = generateKey("creator");
  const sql = insertCreatorKeySql({
    id,
    keyHash: await hashKey(key),
    label: options.label,
    createdAt: now.toISOString(),
    expiresAt: options.expiresAt,
  });

  // An argument list, not a shell string, so nothing in the label is interpreted by a shell.
  // Wrangler's own output goes to stderr, keeping stdout for the key alone.
  execFileSync(
    "npx",
    ["wrangler", "d1", "execute", DATABASE_NAME, options.target, "--command", sql],
    {
      stdio: ["inherit", process.stderr, "inherit"],
    },
  );

  // Only shown once the insert has succeeded, so a failed run never leaves a dangling key.
  console.error(`\nCreator key issued: id ${id}, label "${options.label}".`);
  console.error("Store it now. It is shown only this once:\n");
  console.log(key);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(USAGE);
  process.exitCode = 1;
}
