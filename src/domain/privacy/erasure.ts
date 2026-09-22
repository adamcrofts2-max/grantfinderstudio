/**
 * Making sure somebody means it.
 *
 * ## Why typing the name, and not a checkbox
 *
 * A checkbox beside "I understand this cannot be undone" is ticked by the same
 * reflex that clicks the button. Typing the organisation's name is a different
 * act: it cannot be done by accident, and — more importantly here — it cannot
 * be done in the WRONG account. Somebody with two organisations open in two
 * tabs is exactly the person this protects, and a checkbox would not have.
 *
 * ## Why a fallback word
 *
 * An organisation that has not been through onboarding has no legal name yet,
 * and asking somebody to type a blank is asking them to guess. There is a word
 * for that case, and the form shows whichever it is asking for rather than
 * leaving them to work it out.
 */

/** Asked for when the organisation has no name to type. */
export const FALLBACK_WORD = 'DELETE';

/** What this organisation's owner has to type to erase it. */
export function confirmationWord(organisationName: string | null): string {
  const name = (organisationName ?? '').trim();
  return name === '' ? FALLBACK_WORD : name;
}

/**
 * Whether what they typed matches.
 *
 * Case and surrounding space are forgiven: the point is to prove they know
 * which account they are in, not to test their typing. Nothing else is —
 * "Future Forest" does not erase Future Forests CIC.
 */
export function confirms(typed: string, organisationName: string | null): boolean {
  const wanted = confirmationWord(organisationName);
  return typed.trim().toLowerCase() === wanted.trim().toLowerCase();
}

/** What the form asks, in the words it asks it. */
export function confirmationPrompt(organisationName: string | null): string {
  const wanted = confirmationWord(organisationName);
  return wanted === FALLBACK_WORD
    ? `Type ${FALLBACK_WORD} to confirm.`
    : `Type the organisation’s name — ${wanted} — to confirm.`;
}

/**
 * What the delete is about to remove, as a sentence.
 *
 * Built from real counts rather than a fixed warning, because "this will
 * delete 3 applications, 41 answers and 2 documents" is a different decision
 * from "delete everything?" — and it is the only way somebody can tell they
 * are looking at the right account before they erase it.
 */
export function willRemove(counts: ReadonlyArray<{ label: string; rows: number }>): string {
  if (counts.length === 0) {
    return 'There is nothing in this organisation yet. Deleting it removes the account itself.';
  }
  const parts = counts.map((c) => `${c.rows} ${c.rows === 1 ? singular(c.label) : c.label}`);
  const last = parts.pop();
  const list = parts.length === 0 ? last : `${parts.join(', ')} and ${last}`;
  return `This removes ${list}. It cannot be undone.`;
}

/**
 * The nouns arrive plural, because a count is usually more than one. A count
 * of exactly one still has to read properly.
 *
 * Crude on purpose — it handles the nouns in `PRIVACY_RECORD` and nothing
 * else, and `record.ts` is where a new one would be added, next to this.
 */
function singular(noun: string): string {
  // Two shapes, and they pluralise at opposite ends. "pieces of evidence"
  // takes its plural on the head; "earlier drafts" takes it on the tail.
  const [before, ...after] = noun.split(' of ');
  if (after.length > 0 && before !== undefined) {
    return [lastWord(before), ...after].join(' of ');
  }
  return lastWord(noun);
}

/** Singularise the final word of a phrase, leaving its modifiers alone. */
function lastWord(phrase: string): string {
  const words = phrase.split(' ');
  const last = words.pop();
  if (last === undefined) return phrase;
  return [...words, singularWord(last)].join(' ');
}

function singularWord(word: string): string {
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('ches') || word.endsWith('shes')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}
