import { z } from "zod";

/**
 * Key labels, such as "Kyoto desk – laptop". Shared by the API and the admin scripts.
 * Labels should name a role and a device, not a person: a name would be personal data.
 */
export const MAX_LABEL_LENGTH = 100;

export const labelSchema = z
  .string()
  .trim()
  .min(1, "A label can't be empty.")
  .max(MAX_LABEL_LENGTH, `A label can be at most ${String(MAX_LABEL_LENGTH)} characters.`)
  .regex(/^\P{Cc}*$/u, "A label can't contain control characters.");

/** The label, trimmed, or `null` if it breaks a rule. */
export function normaliseLabel(raw: string): string | null {
  const result = labelSchema.safeParse(raw);
  return result.success ? result.data : null;
}
