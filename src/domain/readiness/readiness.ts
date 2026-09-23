/**
 * Application readiness.
 *
 * This measures COMPLETENESS — how much of the application is done and sound.
 * It is explicitly not a prediction of success. We have no outcome data that
 * would justify one, and a number that looks like a win probability would be
 * read as one.
 */

export type ReadinessComponentId =
  | 'eligibility'
  | 'questions'
  | 'evidence'
  | 'budget'
  | 'outcomes'
  | 'attachments'
  | 'compliance';

export interface ReadinessComponent {
  id: ReadinessComponentId;
  label: string;
  /** 0–1. Null when the component does not apply to this application. */
  score: number | null;
  /** What the user should do next to move this component forward. */
  detail: string;
}

/**
 * What the eligibility engine actually found, rather than just its verdict.
 *
 * This was a bare `'eligible' | 'ineligible' | 'unknown'`, and the readiness
 * card said "Some eligibility questions are unresolved" for every unknown —
 * including the two cases where there was no question to resolve. A funder who
 * publishes no rules we hold and an applicant whose own details are not in yet
 * are both `unknown`, and neither of them has an unresolved question in it.
 *
 * A breakdown that names the row has to make the row's sentence true, so the
 * counts come with the verdict.
 */
export interface EligibilityReadiness {
  verdict: 'eligible' | 'ineligible' | 'unknown';
  /** Verified criteria evaluated. Zero means we hold no rules for this fund. */
  checked: number;
  /** Of those, how many could not be decided from what we know. */
  undecided: number;
  /** False when the organisation's own details or the project are not in yet. */
  applicantKnown: boolean;
}

export interface ReadinessInput {
  eligibility: EligibilityReadiness;
  questionsTotal: number;
  questionsAnswered: number;
  /** Answers that contain at least one claim with no confirmed fact behind it. */
  answersWithUnsupportedClaims: number;
  evidenceNeeded: number;
  evidenceProvided: number;
  budgetSubmittable: boolean;
  budgetHasLines: boolean;
  /**
   * Whether any verified funder rule was checked against the budget. Absent
   * means no: the weaker sentence is the default, so a caller that forgets
   * this cannot make the card claim a check nobody ran.
   */
  budgetRulesChecked?: boolean;
  outcomesDefined: number;
  attachmentsRequired: number;
  attachmentsProvided: number;
  /** Answers exceeding the funder's word limit. */
  answersOverWordLimit: number;
}

export interface ReadinessResult {
  /** 0–100, rounded. Completeness, not probability of success. */
  percent: number;
  components: ReadinessComponent[];
  /**
   * How many components the percentage is the average of.
   *
   * Reported rather than left to be counted again by whoever shows the
   * breakdown: a screen that names the parts has to be able to say which of
   * them the number came from, and deriving that separately is how a caption
   * ends up describing a rule the engine no longer follows.
   */
  counted: number;
  /** Things that would stop submission outright. */
  blockers: string[];
}

function ratio(done: number, total: number): number | null {
  if (total === 0) return null;
  return Math.min(1, Math.max(0, done / total));
}

function eligibilityScore(eligibility: EligibilityReadiness): number | null {
  if (eligibility.verdict === 'eligible') return 1;
  if (eligibility.verdict === 'ineligible') return 0;
  if (!eligibility.applicantKnown || eligibility.checked === 0) return null;
  return 0.5;
}

function eligibilityDetail(eligibility: EligibilityReadiness): string {
  const { verdict, checked, undecided, applicantKnown } = eligibility;
  if (verdict === 'ineligible') return 'You do not meet this funder’s criteria.';
  if (verdict === 'eligible') {
    return checked === 1
      ? 'You meet the one criterion this funder publishes.'
      : `You meet all ${checked} criteria this funder publishes.`;
  }
  if (!applicantKnown) {
    return 'Your own details are not in yet, so there is nothing to check against.';
  }
  if (checked === 0) {
    return 'Nothing is published here about who can apply, so there is nothing to check.';
  }
  return undecided === 1
    ? `1 of ${checked} criteria cannot be decided from what we know about you.`
    : `${undecided} of ${checked} criteria cannot be decided from what we know about you.`;
}

export function assessReadiness(input: ReadinessInput): ReadinessResult {
  const components: ReadinessComponent[] = [];
  const blockers: string[] = [];

  // Eligibility is binary and dominant: an ineligible application is not
  // "nearly ready", it is not submittable at all.
  //
  // NULL, not a half mark, for the two unknowns that are not about this
  // application at all. A funder publishing no rules we hold, and an
  // organisation whose own details are not in yet, are both unmeasured — and
  // scoring an unmeasured thing 50% puts a number on the screen that no work
  // can move. Unmeasured components are excluded from the average, the way an
  // application with no required attachments is not penalised for having none.
  //
  // An unknown with criteria behind it is different: there IS something to
  // resolve, and half marks say so.
  components.push({
    id: 'eligibility',
    label: 'Eligibility',
    score: eligibilityScore(input.eligibility),
    detail: eligibilityDetail(input.eligibility),
  });
  if (input.eligibility.verdict === 'ineligible') {
    blockers.push('You are not eligible for this fund.');
  }

  // ZERO, not "does not apply". `ratio(0, 0)` is null, and a null score is
  // excluded from the average — so an application with no questions in it
  // scored full marks on everything that was left and reported 100% ready,
  // above the words "0 of 0 questions answered". An application with nothing
  // in it is not nearly ready; it has not been started.
  components.push({
    id: 'questions',
    label: 'Questions',
    score: input.questionsTotal === 0 ? 0 : ratio(input.questionsAnswered, input.questionsTotal),
    detail:
      input.questionsTotal === 0
        ? 'No questions have been imported yet.'
        : `${input.questionsAnswered} of ${input.questionsTotal} answered.`,
  });
  if (input.questionsTotal === 0) {
    blockers.push('No questions from the funder’s form yet.');
  } else if (input.questionsAnswered < input.questionsTotal) {
    const remaining = input.questionsTotal - input.questionsAnswered;
    blockers.push(
      remaining === 1 ? '1 question still to answer.' : `${remaining} questions still to answer.`,
    );
  }

  const evidenceScore = ratio(input.evidenceProvided, input.evidenceNeeded);
  components.push({
    id: 'evidence',
    label: 'Evidence',
    score: evidenceScore,
    detail:
      input.evidenceNeeded === 0
        ? 'No evidence gaps identified.'
        : `${input.evidenceProvided} of ${input.evidenceNeeded} claims evidenced.`,
  });
  if (input.answersWithUnsupportedClaims > 0) {
    const n = input.answersWithUnsupportedClaims;
    blockers.push(
      n === 1
        ? '1 answer contains a claim with no confirmed source.'
        : `${n} answers contain claims with no confirmed source.`,
    );
  }

  components.push({
    id: 'budget',
    label: 'Budget',
    score: !input.budgetHasLines ? 0 : input.budgetSubmittable ? 1 : 0.5,
    detail: !input.budgetHasLines
      ? 'No budget has been built yet.'
      : input.budgetSubmittable
        ? // "Consistent with the funder's rules" was said even when the funder
          // had none on record, so the only check made was the total. Found
          // by the September 2026 walk, on a fund typed in by hand.
          input.budgetRulesChecked === true
          ? 'The budget is consistent with the funder’s rules.'
          : 'The budget adds up to what you are asking for. There are no funder rules on record to check it against.'
        : 'The budget has problems that would be noticed by an assessor.',
  });
  if (input.budgetHasLines && !input.budgetSubmittable) {
    blockers.push('The budget has unresolved errors.');
  }
  if (!input.budgetHasLines) blockers.push('No budget has been built.');

  components.push({
    id: 'outcomes',
    label: 'Outcomes',
    score: input.outcomesDefined > 0 ? 1 : 0,
    detail:
      input.outcomesDefined > 0
        ? `${input.outcomesDefined} outcomes defined.`
        : 'No outcomes defined yet.',
  });
  if (input.outcomesDefined === 0) blockers.push('No outcomes have been defined.');

  const attachmentScore = ratio(input.attachmentsProvided, input.attachmentsRequired);
  components.push({
    id: 'attachments',
    label: 'Attachments',
    score: attachmentScore,
    detail:
      input.attachmentsRequired === 0
        ? 'No attachments required.'
        : `${input.attachmentsProvided} of ${input.attachmentsRequired} provided.`,
  });
  if (
    input.attachmentsRequired > 0 &&
    input.attachmentsProvided < input.attachmentsRequired
  ) {
    const missing = input.attachmentsRequired - input.attachmentsProvided;
    blockers.push(
      missing === 1
        ? '1 required attachment missing.'
        : `${missing} required attachments missing.`,
    );
  }

  const compliant = input.answersOverWordLimit === 0;
  components.push({
    id: 'compliance',
    label: 'Word limits',
    // Not applicable until something has been written. "Every answer is
    // within its word limit" is true of no answers, and a component that
    // scores full marks for emptiness is the same vacuous claim the draft
    // card once made about tracing every sentence of a draft that cited
    // nothing.
    score: input.questionsAnswered === 0 ? null : compliant ? 1 : 0,
    detail:
      input.questionsAnswered === 0
        ? 'Nothing written yet, so there is nothing to measure.'
        : compliant
          // "Every answer is within its word limit" beside a full green bar,
          // on an application with one answer out of three, reads as a
          // compliant application. It is only a claim about what has been
          // written so far, and the breakdown puts it next to a 33% on
          // Questions where the difference matters.
          ? input.questionsAnswered < input.questionsTotal
            ? 'Every answer so far is within its word limit.'
            : 'Every answer is within its word limit.'
          : `${input.answersOverWordLimit} answers exceed their word limit.`,
  });
  if (!compliant) {
    blockers.push(
      input.answersOverWordLimit === 1
        ? '1 answer is over the word limit.'
        : `${input.answersOverWordLimit} answers are over the word limit.`,
    );
  }

  // Components that do not apply are excluded rather than counted as zero, so
  // an application with no required attachments is not penalised for it.
  //
  // Never empty: questions, budget and outcomes always carry a number, even
  // when that number is zero. Eligibility used to be the guarantee and no
  // longer is — it can now be unmeasured — so the guarantee is written down
  // here rather than assumed, and `src/domain/readiness/readiness.test.ts`
  // asserts it for an application with nothing in it at all.
  const applicable = components.filter(
    (c): c is ReadinessComponent & { score: number } => c.score !== null,
  );
  const percent = Math.round(
    (applicable.reduce((sum, c) => sum + c.score, 0) / applicable.length) * 100,
  );

  return { percent, components, counted: applicable.length, blockers };
}
