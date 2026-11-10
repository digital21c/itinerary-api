import { parseVersionNumber } from "../models/versions";
import type { VersionHead } from "../repositories/types";
import { singleStrongTag } from "../utils/entity-tags";
import {
  documentGone,
  malformedIfMatch,
  preconditionFailed,
  preconditionRequired,
} from "./problems";

/**
 * The `If-Match` checks every content write makes, before its body is read (RFC 9110 §13.2.1):
 * `428` if missing, `400` unless exactly one strong version tag, `410` if the document is
 * deleted, `412` unless it names the latest version.
 *
 * With `allowRestore`, a deleted document accepts a write whose `If-Match` names its deletion
 * marker: that is how a deleted document is restored. Any other version is still `410`.
 *
 * The `412` here is a shortcut for the common case. The conditional statement in the
 * repository repeats the check atomically, which is what actually stops a race.
 */
export function checkWritePreconditions(
  ifMatch: string | undefined,
  latest: VersionHead,
  options: { allowRestore: boolean },
): { ok: true; baseVersion: number } | { ok: false; response: Response } {
  if (ifMatch === undefined) {
    return { ok: false, response: preconditionRequired() };
  }
  const tag = singleStrongTag(ifMatch);
  const baseVersion = tag === null ? null : parseVersionNumber(tag);
  if (baseVersion === null) {
    return { ok: false, response: malformedIfMatch() };
  }
  if (latest.deleted) {
    const isRestore = options.allowRestore && baseVersion === latest.version;
    if (!isRestore) {
      return { ok: false, response: documentGone() };
    }
  }
  if (baseVersion !== latest.version) {
    return { ok: false, response: preconditionFailed() };
  }
  return { ok: true, baseVersion };
}
