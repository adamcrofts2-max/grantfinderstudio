/**
 * The three things every funder asks about your work.
 *
 * ## The gap this closes
 *
 * The Writer would not draft below five confirmed facts, and setup made sure
 * you had five: legal name, legal form, company number, incorporation date and
 * area. Those are what Companies House knows about you. Not one of them says
 * what you DO — so the gate was met by an organisation the Writer could not
 * have written a single sentence about, and the first question on nearly every
 * form ("tell us about your organisation and its work") went unanswered.
 *
 * So the gate now counts the work: what you do, who it is for, and how many
 * people you reach. They are the overlap of every application form the
 * product has been pointed at, in the order those forms ask.
 *
 * Pure and zero I/O, like the rest of the domain.
 */

import { readSelfDeclaredFact } from './self-declared.js';

export type WorkQuestionId = 'what' | 'who' | 'how_many';

export interface WorkQuestion {
  id: WorkQuestionId;
  /** The claim a typed answer is stored under. */
  claim: string;
  /**
   * Every claim that answers the question once confirmed. A mission read off
   * the organisation's website answers "what do you do" just as well as one
   * typed here, and asking again for something already on the page reads as
   * the product not listening.
   */
  answeredBy: readonly string[];
  /** What the question is, on a form. */
  question: string;
  /** The same, as a phrase inside a sentence or a button: "tell us …". */
  phrase: string;
  /** Why a funder wants it — in one sentence, never what the field is. */
  why: string;
  placeholder: string;
}

export const WORK_QUESTIONS: readonly WorkQuestion[] = [
  {
    id: 'what',
    claim: 'mission',
    answeredBy: ['mission', 'programme_description'],
    question: 'What does your organisation do?',
    phrase: 'what you do',
    why: 'Almost every form opens with it, and funders quote it back at you.',
    placeholder:
      'We grow native trees from local seed and run planting days that give young people practical skills and a first reference.',
  },
  {
    id: 'who',
    claim: 'beneficiary_groups',
    answeredBy: ['beneficiary_groups'],
    question: 'Who is it for?',
    phrase: 'who it is for',
    why: 'Most eligibility rules turn on who benefits.',
    placeholder: 'Young people aged 16 to 24 in Somerset who are not in work, education or training.',
  },
  {
    id: 'how_many',
    claim: 'people_supported_last_year',
    answeredBy: ['people_supported_last_year'],
    question: 'How many people did you work with last year?',
    phrase: 'how many you reach',
    why: 'It is the figure that makes a case concrete rather than earnest. A rough number is fine if you say it is rough — and if you are new, say so.',
    placeholder: 'About 120 young people across 14 courses.',
  },
] as const;

/** Every claim that answers one of the three. */
export const WORK_CLAIMS: readonly string[] = [
  ...new Set(WORK_QUESTIONS.flatMap((question) => question.answeredBy)),
];

/**
 * The questions no confirmed fact answers yet, in the order a form asks them.
 *
 * Takes CONFIRMED claims only. An unconfirmed mission proposed by the website
 * reader is a guess until somebody says it is right, and the Writer will not
 * ground a sentence in it — so it does not answer the question either.
 */
export function unansweredAboutTheWork(
  confirmedClaims: readonly string[],
): WorkQuestion[] {
  const held = new Set(confirmedClaims);
  return WORK_QUESTIONS.filter(
    (question) => !question.answeredBy.some((claim) => held.has(claim)),
  );
}

/** "what you do, who it is for and how many you reach". */
export function listOfQuestions(questions: readonly WorkQuestion[]): string {
  const phrases = questions.map((question) => question.phrase);
  if (phrases.length <= 1) return phrases.join('');
  return `${phrases.slice(0, -1).join(', ')} and ${phrases.at(-1)}`;
}

export interface WorkAnswers {
  /** What to store, one confirmed fact per answered question. */
  facts: { claim: string; value: string }[];
  /** Per-claim problems, keyed by the form field — which is the claim. */
  errors: Record<string, string>;
  /**
   * Nothing was typed at all. Not a problem with any one answer, so it is
   * not pinned to a field — the first field is off-screen by the time
   * somebody has scrolled down to the button.
   */
  blank: boolean;
}

/**
 * Read the answers a person typed, question by question.
 *
 * Only the three known claims are read, whatever else arrives: the field
 * names come from the browser, and a form that stored any key it was sent
 * would let a crafted request write a fact under any claim at all.
 *
 * A blank answer is skipped rather than refused — somebody who knows what
 * they do but not last year's numbers should not lose the first two to the
 * third. But an entirely blank submission saves nothing and says so.
 */
export function readWorkAnswers(read: (claim: string) => string): WorkAnswers {
  const facts: WorkAnswers['facts'] = [];
  const errors: Record<string, string> = {};

  for (const question of WORK_QUESTIONS) {
    const typed = read(question.claim);
    if (typed.trim() === '') continue;
    const { fact, errors: problems } = readSelfDeclaredFact({
      claim: question.claim,
      value: typed,
    });
    if (fact === null) errors[question.claim] = problems['value'] ?? 'Check this answer.';
    else facts.push(fact);
  }

  const blank = facts.length === 0 && Object.keys(errors).length === 0;
  return Object.keys(errors).length > 0
    ? { facts: [], errors, blank }
    : { facts, errors, blank };
}
