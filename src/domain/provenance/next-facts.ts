/**
 * Which facts to ask for next, and why those.
 *
 * ## The gap this closes
 *
 * The Writer will not draft below `CONFIRMED_FACTS_NEEDED` confirmed facts,
 * and the setup guide dutifully said "Tell us about yourself (4 of 5)". Four of
 * five WHAT? A CIC who has confirmed their name, legal form, area and
 * incorporation date has no idea what a fifth fact is supposed to be — and the
 * page they were sent to led with "Everything is checked", which is true about
 * the facts on the page and false about whether there are enough of them.
 *
 * So the product was asking somebody to satisfy a counter. Naming the fact,
 * and saying what it is for, turns that into a question anybody can answer.
 *
 * ## Why this order
 *
 * The first four are what nearly every application form asks for in its first
 * page, in roughly the order it asks: what you do, who for, where, and how
 * big you are. Nothing here is a guess about a particular funder — it is the
 * overlap of every form the product has been pointed at.
 */

import { readableClaim, SUGGESTED_CLAIMS } from './self-declared.js';

export interface FactPrompt {
  claim: string;
  /** What to call it in front of somebody. */
  label: string;
  /** WHY a funder wants it, in one clause. Never what the field is. */
  because: string;
}

/**
 * The claims worth asking for first, most useful first.
 *
 * A subset of `SUGGESTED_CLAIMS` — the form still offers all of them. This is
 * only about what to put in front of somebody who does not know what to type.
 */
export const FACT_PROMPTS: readonly FactPrompt[] = [
  {
    claim: 'mission',
    label: 'What you exist to do',
    because: 'almost every form opens with it, and funders quote it back at you',
  },
  {
    claim: 'beneficiary_groups',
    label: 'Who you are for',
    because: 'most eligibility rules turn on who benefits',
  },
  {
    claim: 'programme_description',
    label: 'What the work actually is',
    because: 'it is the answer to “what will the money pay for”',
  },
  {
    claim: 'annual_turnover',
    label: 'Your annual turnover',
    because: 'many funders cap or floor the size of organisation they will fund',
  },
  {
    claim: 'people_supported_last_year',
    label: 'How many people you supported last year',
    because: 'it is the number that makes a case concrete rather than earnest',
  },
  {
    claim: 'staff_count',
    label: 'How many staff you have',
    because: 'it tells a funder whether you can deliver what you are proposing',
  },
  {
    claim: 'previous_funders',
    label: 'Who has funded you before',
    because: 'a funder who sees somebody else took the risk first is reassured',
  },
] as const;

/**
 * The next few facts worth asking this organisation for.
 *
 * Skips what they already hold — confirmed or not — because being asked again
 * for something already on the page reads as the product not listening.
 */
export function nextFacts(
  knownClaims: readonly string[],
  howMany = 3,
): FactPrompt[] {
  const known = new Set(knownClaims);
  const unasked = FACT_PROMPTS.filter((prompt) => !known.has(prompt.claim));
  if (unasked.length >= howMany) return unasked.slice(0, howMany);

  // Past the curated list, fall back to the wider vocabulary rather than
  // running out of suggestions — with no `because`, since inventing a reason
  // for every claim in the vocabulary would mean writing fifteen of them badly.
  const extra = SUGGESTED_CLAIMS.filter(
    (claim) => !known.has(claim) && !unasked.some((prompt) => prompt.claim === claim),
  ).map((claim) => ({ claim, label: readableClaim(claim), because: '' }));

  return [...unasked, ...extra].slice(0, howMany);
}

/**
 * How many more confirmed facts are needed, and what to say about it.
 *
 * Returns null when there are enough. The caller should say nothing at all in
 * that case rather than congratulating somebody — a checklist that outstays
 * its usefulness is nagging, which is the rule the setup guide already follows.
 */
export function factShortfall(
  confirmed: number,
  needed: number,
): { short: number; sentence: string } | null {
  if (confirmed >= needed) return null;
  const short = needed - confirmed;
  return {
    short,
    sentence:
      confirmed === 0
        ? `The Writer drafts only from facts you have confirmed, and it needs ${needed}.`
        : `${short} more confirmed fact${short === 1 ? '' : 's'} and the Writer can draft for you — it needs ${needed}, and you have ${confirmed}.`,
  };
}
