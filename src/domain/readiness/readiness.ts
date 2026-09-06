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

export interface ReadinessInput {
  eligibilityVerdict: 'eligible' | 'ineligible' | 'unknown';
  questionsTotal: number;
  questionsAnswered: number;
  /** Answers that contain at least one claim with no confirmed fact behind it. */
  answersWithUnsupportedClaims: number;
  evidenceNeeded: number;
  evidenceProvided: number;
  budgetSubmittable: boolean;
  budgetHasLines: boolean;
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
  /** Things that would stop submission outright. */
  blockers: string[];
}

function ratio(done: number, total: number): number | null {
  if (total === 0) return null;
  return Math.min(1, Math.max(0, done / total));
}

export function assessReadiness(input: ReadinessInput): ReadinessResult {
  const components: ReadinessComponent[] = [];
  const blockers: string[] = [];

  // Eligibility is binary and dominant: an ineligible application is not
  // "nearly ready", it is not submittable at all.
  const eligibilityScore =
    input.eligibilityVerdict === 'eligible'
      ? 1
      : input.eligibilityVerdict === 'unknown'
        ? 0.5
        : 0;
  components.push({
    id: 'eligibility',
    label: 'Eligibility',
    score: eligibilityScore,
    detail:
      input.eligibilityVerdict === 'eligible'
        ? 'You meet every criterion we can check.'
        : input.eligibilityVerdict === 'unknown'
          ? 'Some eligibility questions are unresolved.'
          : 'You do not meet this funder’s criteria.',
  });
  if (input.eligibilityVerdict === 'ineligible') {
    blockers.push('You are not eligible for this fund.');
  }

  const questionScore = ratio(input.questionsAnswered, input.questionsTotal);
  components.push({
    id: 'questions',
    label: 'Questions',
    score: questionScore,
    detail:
      input.questionsTotal === 0
        ? 'No questions have been imported yet.'
        : `${input.questionsAnswered} of ${input.questionsTotal} answered.`,
  });
  if (input.questionsTotal > 0 && input.questionsAnswered < input.questionsTotal) {
    blockers.push(
      `${input.questionsTotal - input.questionsAnswered} questions still to answer.`,
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
    blockers.push(
      `${input.answersWithUnsupportedClaims} answers contain claims with no confirmed source.`,
    );
  }

  components.push({
    id: 'budget',
    label: 'Budget',
    score: !input.budgetHasLines ? 0 : input.budgetSubmittable ? 1 : 0.5,
    detail: !input.budgetHasLines
      ? 'No budget has been built yet.'
      : input.budgetSubmittable
        ? 'The budget is consistent with the funder’s rules.'
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
    blockers.push(
      `${input.attachmentsRequired - input.attachmentsProvided} required attachments missing.`,
    );
  }

  const compliant = input.answersOverWordLimit === 0;
  components.push({
    id: 'compliance',
    label: 'Word limits',
    score: compliant ? 1 : 0,
    detail: compliant
      ? 'Every answer is within its word limit.'
      : `${input.answersOverWordLimit} answers exceed their word limit.`,
  });
  if (!compliant) {
    blockers.push(`${input.answersOverWordLimit} answers are over the word limit.`);
  }

  // Components that do not apply are excluded rather than counted as zero, so
  // an application with no required attachments is not penalised for it.
  // Eligibility always carries a score, so this is never empty.
  const applicable = components.filter(
    (c): c is ReadinessComponent & { score: number } => c.score !== null,
  );
  const percent = Math.round(
    (applicable.reduce((sum, c) => sum + c.score, 0) / applicable.length) * 100,
  );

  return { percent, components, blockers };
}
