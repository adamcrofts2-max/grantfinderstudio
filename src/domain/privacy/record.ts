/**
 * What this product holds, why, where it goes and how long it stays.
 *
 * ## Why this is code and not a page of prose
 *
 * A privacy notice written by hand is true on the day it is written and drifts
 * from the schema with the next migration. Nobody notices, because nothing
 * checks — which is how a product ends up publishing a description of a
 * database it no longer has.
 *
 * So the notice is RENDERED FROM THIS, and `src/db/privacy-record.test.ts` asks the live
 * schema for its table list and fails when a table holding tenant or personal
 * data is not classified here. Adding a table forces a decision about what it
 * holds and how long it stays, at the moment the table is added, by someone
 * who knows the answer.
 *
 * ## What is deliberately absent
 *
 * There is no analytics, no tracking, no third-party script, and no IP address
 * stored anywhere in the schema. Those are not omissions from this list; they
 * are facts about the product, asserted by `src/db/privacy-record.test.ts` for the
 * columns and checked by eye for the rest.
 */

import { ACCOUNT_CONSTANTS } from '../auth/account.js';
import { SHARE_DAYS } from '../review/share.js';

/** Who, outside this system, ever sees a given kind of data. */
export type Recipient = 'anthropic' | 'companies_house' | 'reviewer';



export const RECIPIENTS: Record<Recipient, { name: string; what: string; why: string }> = {
  anthropic: {
    name: 'Anthropic',
    what: 'The text of whatever the Writer or the Critic is working on — a question, your confirmed facts, the answer being checked.',
    why: 'Drafting and criticism run on their models. Nothing is sent unless you press the button that sends it, and the product works without a key at all.',
  },
  companies_house: {
    name: 'Companies House',
    what: 'A company name or number you typed, to look up.',
    why: 'To fill your organisation’s legal details from the public register rather than asking you to type them twice.',
  },
  reviewer: {
    name: 'Somebody you share an application with',
    what: 'One application: its answers, the evidence behind each claim, and what the funder’s rules say.',
    why: 'You made a read-only link for them. It expires, you can withdraw it, and every visit is on your own record.',
  },
};

/** How long something stays. */
export type Retention =
  | { kind: 'while_open' }
  | { kind: 'days'; days: number; note: string }
  | { kind: 'superseded'; note: string };

/** Whose data it is, which decides who can ask for it back or ask for it gone. */
export type Subject = 'organisation' | 'person' | 'operational';

export interface Held {
  /** The table, spelled exactly as the schema spells it. */
  table: string;
  /** What a person would call it. */
  label: string;
  /**
   * The plural noun a count reads with: "3 applications", not "3 your
   * applications". Separate from `label` because a heading and a quantity
   * want different words, and the delete confirmation is built from counts.
   */
  counted: string;
  /** What is actually in the columns. */
  holds: string;
  /** The feature that needs it. Not a purpose in the abstract. */
  why: string;
  subject: Subject;
  /** Everyone outside this system who sees it. Empty means nobody. */
  leaves: readonly Recipient[];
  kept: Retention;
}

const WHILE_OPEN: Retention = { kind: 'while_open' };

/**
 * Tables that hold no personal or tenant data at all, and why each one is out.
 *
 * Listed rather than filtered by a rule, because "it looked like reference
 * data" is exactly the judgement that goes wrong quietly. The database test
 * requires every table to be in one list or the other.
 */
export const NOT_ABOUT_YOU: Record<string, string> = {
  source_datasets: 'The licence and attribution of an open dataset we loaded.',
  funders: 'UK funders, from open data. The same rows for every organisation.',
  funder_awards: 'Grants funders published under an open licence. Nothing of yours.',
  opportunities:
    'Funds. Shared, except for the ones an organisation typed in by hand, which are private to it — a pasted fund can name a relationship nobody else should see.',
  eligibility_criteria: 'The rules attached to a fund, shared like the fund.',
  corpus_load: 'How far the open-data load has got. Counts and timestamps.',
  app_settings: 'Our own configuration. Nothing of any customer’s.',
  app_credentials: 'Our own API keys, encrypted and write-only.',
  admin_accounts: 'Staff who run the console. Not customers, and not covered here.',
  admin_sessions: 'Staff sign-ins to the console.',
  schema_migrations: 'Which migrations have run.',
};

/**
 * Everything held about an organisation or the people in it.
 *
 * Ordered as somebody reading would want it: who you are, what you are
 * applying for, what you wrote, who saw it, and the operational residue.
 */
export const PRIVACY_RECORD: readonly Held[] = [
  {
    table: 'users',
    label: 'Your sign-in',
    counted: 'sign-ins',
    holds: 'An email address, and a name if you gave one.',
    why: 'To let you back in, and to say who confirmed a fact when more than one of you uses the account.',
    subject: 'person',
    leaves: [],
    kept: WHILE_OPEN,
  },
  {
    table: 'user_passwords',
    label: 'Your password',
    counted: 'passwords',
    holds: 'A hash. Never the password.',
    why: 'To check a sign-in without being able to read what you chose.',
    subject: 'person',
    leaves: [],
    kept: WHILE_OPEN,
  },
  {
    table: 'sessions',
    label: 'Being signed in',
    counted: 'sessions',
    holds:
      'A fingerprint of your session cookie — never the cookie itself — with when it was made and last used.',
    why: 'To keep you signed in, and to let a session expire on its own.',
    subject: 'person',
    leaves: [],
    kept: {
      kind: 'days',
      days: ACCOUNT_CONSTANTS.sessionDays,
      note: 'A session expires and is swept. Signing out ends it at once.',
    },
  },
  {
    table: 'auth_attempts',
    label: 'Failed sign-ins',
    counted: 'throttle counters',
    holds: 'A count against a key, and when the count started. No address, no device.',
    why: 'To slow down somebody guessing at your password.',
    subject: 'operational',
    leaves: [],
    kept: { kind: 'days', days: 1, note: 'Swept once the window has passed.' },
  },
  {
    table: 'organisations',
    label: 'Your organisation',
    counted: 'organisations',
    holds: 'Its name.',
    why: 'Everything else hangs off it.',
    subject: 'organisation',
    leaves: [],
    kept: WHILE_OPEN,
  },
  {
    table: 'memberships',
    label: 'Who is in it',
    counted: 'people',
    holds: 'Which people belong to the organisation, and what each may do.',
    why: 'To decide what each person can see and change.',
    subject: 'organisation',
    leaves: [],
    kept: WHILE_OPEN,
  },
  {
    table: 'organisation_profiles',
    label: 'Your legal details',
    counted: 'organisation profiles',
    holds:
      'Legal name, company number, legal form, incorporation date, where you work, turnover and mission.',
    why: 'The eligibility engine answers "can you apply for this" from these, and never guesses at one it does not have.',
    subject: 'organisation',
    leaves: ['companies_house'],
    kept: WHILE_OPEN,
  },
  {
    table: 'projects',
    label: 'What you are raising money for',
    counted: 'projects',
    holds: 'A name, a description, who benefits, where, how much and for how long.',
    why: 'To match funds to the work, and to fill an application without asking the same question again.',
    subject: 'organisation',
    leaves: ['anthropic'],
    kept: WHILE_OPEN,
  },
  {
    table: 'facts',
    label: 'Your confirmed facts',
    counted: 'facts',
    holds: 'Each claim about your organisation, its value, where it came from and who confirmed it.',
    why: 'Drafted prose is grounded in these, and a sentence with no fact behind it is flagged rather than shipped.',
    subject: 'organisation',
    leaves: ['anthropic'],
    kept: {
      kind: 'superseded',
      note: 'A correction supersedes rather than overwrites, so what you believed and when survives. All of it goes when the account does.',
    },
  },
  {
    table: 'evidence',
    label: 'Evidence you gathered',
    counted: 'pieces of evidence',
    holds: 'A claim, its source, where it was published and when it should be looked at again.',
    why: 'To back a statement of need with something a funder can check.',
    subject: 'organisation',
    leaves: ['anthropic'],
    kept: WHILE_OPEN,
  },
  {
    table: 'documents',
    label: 'Documents you uploaded',
    counted: 'documents',
    holds:
      'The filename, type, size and what we made of it. NOT the file: the original bytes are thrown away after the text is read out of them.',
    why: 'To pull facts out of your accounts, policies and past applications instead of making you retype them.',
    subject: 'organisation',
    leaves: [],
    kept: WHILE_OPEN,
  },
  {
    table: 'document_chunks',
    label: 'Text from your documents',
    counted: 'pieces of extracted text',
    holds: 'The extracted text, in pieces, with page numbers.',
    why: 'So a fact can quote the sentence it came from, and you can see it in context before confirming it.',
    subject: 'organisation',
    leaves: ['anthropic'],
    kept: WHILE_OPEN,
  },
  {
    table: 'applications',
    label: 'Your applications',
    counted: 'applications',
    holds: 'Which fund, how much you asked for, when it went in, and what the funder said.',
    why: 'The tracker, and your own record of what has worked.',
    subject: 'organisation',
    leaves: [],
    kept: WHILE_OPEN,
  },
  {
    table: 'application_questions',
    label: 'The funder’s questions',
    counted: 'questions',
    holds: 'The questions you pasted in, with their word limits and guidance.',
    why: 'To size the work and to give each answer somewhere to live.',
    subject: 'organisation',
    leaves: ['anthropic'],
    kept: WHILE_OPEN,
  },
  {
    table: 'answers',
    label: 'What you wrote',
    counted: 'answers',
    holds: 'The current text of every answer.',
    why: 'It is the application.',
    subject: 'organisation',
    leaves: ['anthropic', 'reviewer'],
    kept: WHILE_OPEN,
  },
  {
    table: 'answer_versions',
    label: 'Earlier drafts',
    counted: 'earlier drafts',
    holds: 'Previous versions of an answer, and who or what wrote each.',
    why: 'So a draft you preferred is not lost, and so an AI draft is distinguishable from your own writing.',
    subject: 'organisation',
    leaves: [],
    kept: WHILE_OPEN,
  },
  {
    table: 'answer_fact_refs',
    label: 'Which fact backs which sentence',
    counted: 'claim references',
    holds: 'Each claim in an answer and the confirmed fact behind it, or a mark saying there is none.',
    why: 'So an unsupported claim is visible before a funder finds it.',
    subject: 'organisation',
    leaves: ['reviewer'],
    kept: WHILE_OPEN,
  },
  {
    table: 'budgets',
    label: 'Your budgets',
    counted: 'budgets',
    holds: 'One per application.',
    why: 'Funders ask for one, and its total has to agree with what you asked for.',
    subject: 'organisation',
    leaves: ['reviewer'],
    kept: WHILE_OPEN,
  },
  {
    table: 'budget_lines',
    label: 'What the money is for',
    counted: 'budget lines',
    holds: 'Each cost, its category and its amount.',
    why: 'To check the budget against the funder’s restrictions before you send it.',
    subject: 'organisation',
    leaves: ['reviewer'],
    kept: WHILE_OPEN,
  },
  {
    table: 'outcomes',
    label: 'What the money would achieve',
    counted: 'outcomes',
    holds: 'Activity, output, outcome, and how anybody would know.',
    why: 'Almost every funder’s form asks for these four, in that order.',
    subject: 'organisation',
    leaves: ['anthropic', 'reviewer'],
    kept: WHILE_OPEN,
  },
  {
    table: 'reviews',
    label: 'The Critic’s findings',
    counted: 'reviews',
    holds: 'What the Critic said about an application, and a readiness score.',
    why: 'So you can see what was flagged and whether you dealt with it.',
    subject: 'organisation',
    leaves: [],
    kept: WHILE_OPEN,
  },
  {
    table: 'application_shares',
    label: 'Review links you made',
    counted: 'review links',
    holds:
      'Your own label for the reader, a fingerprint of the link — never the link — when it expires, and every time it was opened.',
    why: 'Sharing an application with somebody outside your organisation is only defensible if it is recorded: who, for how long, and what they did with it.',
    subject: 'organisation',
    leaves: [],
    kept: {
      kind: 'days',
      days: SHARE_DAYS,
      note: `A link stops working after at most ${SHARE_DAYS} days, or the moment you withdraw it. The record of having made it stays until the account goes.`,
    },
  },
  {
    table: 'share_comments',
    label: 'What your reviewer said',
    counted: 'reviewer comments',
    holds: 'Their comments, against the question each is about.',
    why: 'So a review is something you can act on rather than a conversation somewhere else.',
    subject: 'organisation',
    leaves: [],
    kept: WHILE_OPEN,
  },
  {
    table: 'audit_logs',
    label: 'What happened',
    counted: 'audit entries',
    holds:
      'The shape of every change — what kind, to which thing, by whom, when. Never the words: an answer is recorded as a word count, not as its prose.',
    why: 'It is the record that makes sharing lawful, and the only way to see what an account did.',
    subject: 'organisation',
    leaves: [],
    kept: WHILE_OPEN,
  },
  {
    table: 'ai_generations',
    label: 'What the AI cost',
    counted: 'AI runs',
    holds: 'Which agent ran, which model, how many tokens, how long and what it cost. No prompt, no response.',
    why: 'So you can see what the Writer is costing you.',
    subject: 'organisation',
    leaves: [],
    kept: WHILE_OPEN,
  },
];

/** Every table this record classifies, either as held or as not about you. */
export function classifiedTables(): Set<string> {
  return new Set([
    ...PRIVACY_RECORD.map((held) => held.table),
    ...Object.keys(NOT_ABOUT_YOU),
  ]);
}

/** Everything that ever leaves, grouped by who receives it. */
export function sharedWith(recipient: Recipient): readonly Held[] {
  return PRIVACY_RECORD.filter((held) => held.leaves.includes(recipient));
}

/** True when nothing in the record ever goes to this recipient. */
export function nothingGoesTo(recipient: Recipient): boolean {
  return sharedWith(recipient).length === 0;
}

/** How a retention rule reads. */
export function retentionLine(kept: Retention): string {
  if (kept.kind === 'while_open') return 'Kept while your account is open. Gone when you delete it.';
  if (kept.kind === 'days') return `${kept.note} At most ${kept.days} ${kept.days === 1 ? 'day' : 'days'}.`;
  return kept.note;
}
