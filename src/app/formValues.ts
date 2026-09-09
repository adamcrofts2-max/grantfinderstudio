/**
 * Giving a rejected form back what was typed into it.
 *
 * React resets an uncontrolled form once its action resolves. That is right
 * for a form that succeeded and wrong for one that did not: an operator who
 * mistyped one character in an organisation id was handed eight empty boxes,
 * including a long attribution line they had copied from a licence page.
 * Found by driving the ingest form; it was true of five forms in the product,
 * and worse for a CIC typing a fund in than for an operator.
 *
 * So every action that can fail echoes back what it received, and every input
 * reads its `defaultValue` from that. Successful actions return nothing here —
 * a saved form SHOULD come back empty, ready for the next entry.
 */

export type FormValues = Readonly<Record<string, string>>;

export const NO_VALUES: FormValues = {};

/**
 * Stamped onto every echo so a `<select>` can be keyed on it.
 *
 * `defaultValue` is applied when an element MOUNTS. React's form reset clears
 * a select and then re-renders rather than remounting, so the default is never
 * re-applied and the choice is lost — while text inputs, which React restores
 * from their default, survive. Keying the select on the submission remounts it
 * and the default lands.
 *
 * Only the selects are keyed, not the whole form, so a remount does not steal
 * focus from whatever the person was typing in.
 */
const SUBMITTED_AT = '__submittedAt';

/**
 * Pull the named fields out of a submission, as strings.
 *
 * Single-valued fields only. A checkbox group has several values under one
 * name and would need its own handling; nothing echoed here has one, and
 * silently keeping the first would be worse than not keeping it.
 */
export function readValues(formData: FormData, fields: readonly string[]): FormValues {
  const values: Record<string, string> = { [SUBMITTED_AT]: String(Date.now()) };
  for (const field of fields) {
    const raw = formData.get(field);
    values[field] = typeof raw === 'string' ? raw : '';
  }
  return values;
}

/**
 * A React key for a `<select>` that changes on every submission.
 *
 * See SUBMITTED_AT. Two submissions inside the same millisecond would share a
 * key, and would also be carrying the same value, so nothing is lost.
 */
export function selectKey(values: FormValues, field: string): string {
  return `${values[SUBMITTED_AT] ?? 'initial'}-${field}`;
}

/** Read one back for a `defaultValue`, without spreading `?? ''` everywhere. */
export function valueOf(values: FormValues, field: string): string {
  return values[field] ?? '';
}
