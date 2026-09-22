/**
 * What the funder said, and what a pile of those answers adds up to.
 *
 * ## Why this is the piece that was missing
 *
 * Everything else in the product runs forwards: find a fund, check the rules,
 * price the work, draft it, send it. The tracker's last state was "Submitted.
 * Nothing further to do until the funder replies." — and the funder's reply
 * landed in an inbox the product never saw. So an organisation using this for
 * a year would still not be able to say, from inside it, which funders had
 * said yes.
 *
 * That is not a reporting nicety. The whole pitch of this product is
 * "evidence, not guesswork": it works back from grants funders actually gave.
 * An applicant's own answers are the only evidence they own outright, and
 * they are the strongest thing a second application can argue from.
 *
 * ## Three answers, not two
 *
 * Silence is the commonest outcome of a UK grant application and it is not a
 * rejection. Treating it as one would understate every funder's openness and
 * overstate the applicant's failure. It is recorded as itself, and it is kept
 * out of the numerator AND the denominator of a success rate, because nobody
 * decided anything.
 *
 * ## No score
 *
 * There is a success rate here, and it is deliberately withheld until there is
 * enough to read one from. Three applications, one funded, is not "33%" — it
 * is three applications. A percentage printed over a handful of events invites
 * exactly the false confidence this product exists to replace.
 */

/** The three things a funder's answer can be. */
export type Decision = 'awarded' | 'rejected' | 'no_reply';

export const DECISIONS: readonly Decision[] = ['awarded', 'rejected', 'no_reply'];

export function isDecision(value: string): value is Decision {
  return (DECISIONS as readonly string[]).includes(value);
}

/**
 * How many decided applications it takes before a success rate is worth
 * printing. Below this the counts are shown and the percentage is not.
 */
export const ENOUGH_TO_RATE = 5;

/** The longest note we will store against an outcome. */
export const MAX_NOTE_LENGTH = 2000;

/**
 * An upper bound on a single award, in pounds. Not a judgement about what a
 * CIC can win — it is here to catch a pence figure pasted into a pounds box,
 * which is the mistake that would otherwise silently multiply a total by a
 * hundred.
 */
export const MAX_AWARD_GBP = 100_000_000;

export interface DecisionRecord {
  decision: Decision;
  /** ISO date, YYYY-MM-DD. The day the answer arrived, not the day it was typed. */
  decidedOn: string;
  /** Only ever set for an award, and null there too when the sum is not yet known. */
  amountAwardedGbp: number | null;
  /** The funder's reason, or the applicant's own. Null when nothing was said. */
  note: string | null;
}

export interface DecisionInput {
  decision: string;
  decidedOn: string;
  amountAwardedGbp?: string;
  note?: string;
}

export interface DecisionContext {
  /** Today, ISO. Passed in so one render reasons against one date. */
  today: string;
  /** The day it went in, when known. An answer cannot predate the application. */
  submittedOn: string | null;
}

export type DecisionCheck =
  | { ok: true; value: DecisionRecord }
  | { ok: false; field: keyof DecisionInput; reason: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True only for a calendar date that exists: 2026-02-30 is not one. */
function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Read an amount typed by a human: "12,500", "£12,500", "12500.00".
 *
 * Returns null for anything it cannot read, which the caller treats as an
 * error rather than as zero. A grant silently recorded as £0 would be worse
 * than one not recorded at all.
 */
export function readAmount(raw: string): number | null {
  const cleaned = raw.replace(/[£,\s]/g, '');
  if (cleaned === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Turn what was typed into something storable, or say what is wrong with it.
 *
 * Every refusal names a field, so the form can point at the box rather than
 * printing a paragraph above it and leaving the person to hunt.
 */
export function checkDecision(input: DecisionInput, context: DecisionContext): DecisionCheck {
  const decision = input.decision.trim();
  if (!isDecision(decision)) {
    return { ok: false, field: 'decision', reason: 'Choose what the funder said.' };
  }

  const decidedOn = input.decidedOn.trim();
  if (!isRealDate(decidedOn)) {
    return { ok: false, field: 'decidedOn', reason: 'Give the date as a real calendar date.' };
  }
  if (decidedOn > context.today) {
    return { ok: false, field: 'decidedOn', reason: 'That date is in the future.' };
  }
  if (context.submittedOn !== null && decidedOn < context.submittedOn) {
    return {
      ok: false,
      field: 'decidedOn',
      reason: `You recorded this as submitted on ${context.submittedOn}, so an answer cannot have come before then.`,
    };
  }

  const typedAmount = (input.amountAwardedGbp ?? '').trim();
  let amountAwardedGbp: number | null = null;
  if (typedAmount !== '') {
    if (decision !== 'awarded') {
      return {
        ok: false,
        field: 'amountAwardedGbp',
        reason: 'An amount belongs only on an award.',
      };
    }
    const amount = readAmount(typedAmount);
    if (amount === null) {
      return { ok: false, field: 'amountAwardedGbp', reason: 'Write the amount in pounds, as a number.' };
    }
    if (amount <= 0) {
      return { ok: false, field: 'amountAwardedGbp', reason: 'An award has to be more than nothing.' };
    }
    if (amount > MAX_AWARD_GBP) {
      return {
        ok: false,
        field: 'amountAwardedGbp',
        reason: 'That is larger than any UK grant we would expect. Check whether it is in pence.',
      };
    }
    amountAwardedGbp = amount;
  }

  const note = (input.note ?? '').trim();
  if (note.length > MAX_NOTE_LENGTH) {
    return {
      ok: false,
      field: 'note',
      reason: `Keep the note under ${MAX_NOTE_LENGTH} characters. Yours is ${note.length}.`,
    };
  }

  return {
    ok: true,
    value: { decision, decidedOn, amountAwardedGbp, note: note === '' ? null : note },
  };
}

/** One decided application, reduced to what the summary needs. */
export interface DecidedApplication {
  decision: Decision;
  amountAwardedGbp: number | null;
  amountRequestedGbp: number | null;
}

export interface DecisionSummary {
  decided: number;
  awarded: number;
  rejected: number;
  noReply: number;
  /** Sum of the awards whose size was recorded. */
  wonGbp: number;
  /** How many awards had no amount against them, so the total is honest about itself. */
  awardsWithoutAmount: number;
  /** Sum asked for across awarded and rejected applications whose ask is known. */
  askedGbp: number;
  /**
   * Awards as a share of decided-either-way applications, or null when there
   * are too few for the number to mean anything. No-replies are excluded from
   * both halves: nobody decided them.
   */
  successRate: number | null;
  /** Plain English. Never a score, and never a percentage we do not have. */
  sentence: string;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function pounds(value: number): string {
  return `£${Math.round(value).toLocaleString('en-GB')}`;
}

/**
 * What the answers so far add up to.
 *
 * Applications nobody has answered are not passed in; this counts outcomes,
 * not activity, and mixing the two would let a busy month look like a
 * successful one.
 */
export function decisionSummary(applications: readonly DecidedApplication[]): DecisionSummary {
  const awarded = applications.filter((a) => a.decision === 'awarded');
  const rejected = applications.filter((a) => a.decision === 'rejected');
  const noReply = applications.filter((a) => a.decision === 'no_reply');

  const withAmount = awarded.filter((a) => a.amountAwardedGbp !== null);
  const wonGbp = withAmount.reduce((sum, a) => sum + (a.amountAwardedGbp ?? 0), 0);
  const answered = [...awarded, ...rejected];
  const askedGbp = answered.reduce((sum, a) => sum + (a.amountRequestedGbp ?? 0), 0);

  const summary: Omit<DecisionSummary, 'sentence'> = {
    decided: applications.length,
    awarded: awarded.length,
    rejected: rejected.length,
    noReply: noReply.length,
    wonGbp,
    awardsWithoutAmount: awarded.length - withAmount.length,
    askedGbp,
    successRate:
      answered.length >= ENOUGH_TO_RATE ? awarded.length / answered.length : null,
  };

  return { ...summary, sentence: summarySentence(summary) };
}

function summarySentence(s: Omit<DecisionSummary, 'sentence'>): string {
  if (s.decided === 0) return 'No outcomes recorded yet.';

  const parts: string[] = [];
  if (s.awarded > 0) parts.push(`${s.awarded} funded`);
  if (s.rejected > 0) parts.push(`${s.rejected} turned down`);
  if (s.noReply > 0) parts.push(`${s.noReply} with no reply`);

  const head = `${s.decided} ${plural(s.decided, 'answer', 'answers')} recorded: ${parts.join(', ')}.`;

  const money =
    s.wonGbp > 0
      ? ` ${pounds(s.wonGbp)} won${
          s.awardsWithoutAmount > 0
            ? `, plus ${s.awardsWithoutAmount} ${plural(s.awardsWithoutAmount, 'award', 'awards')} with no amount recorded`
            : ''
        }.`
      : s.awarded > 0
        ? ` No amounts recorded against ${plural(s.awarded, 'that award', 'those awards')}.`
        : '';

  const rate =
    s.successRate === null
      ? ` Too few decided either way to read a success rate from yet — ${ENOUGH_TO_RATE} is where that starts to mean anything.`
      : ` That is ${Math.round(s.successRate * 100)}% of the ${s.awarded + s.rejected} a funder actually decided.`;

  return `${head}${money}${rate}`;
}
