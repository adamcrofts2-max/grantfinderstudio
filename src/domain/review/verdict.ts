/**
 * The eligibility verdict, said to somebody who is not the applicant.
 *
 * ## Why this is not `eligibilityDetail`
 *
 * The readiness card's sentences are addressed to the applicant — "You meet
 * all 4 criteria this funder publishes", "Your own details are not in yet".
 * Read by the treasurer they asked to check it over, every one of those
 * pronouns is wrong, and a reviewer told "you do not meet this funder's
 * criteria" has been told something false about themselves.
 *
 * So the same three verdicts, phrased for a reader. Not a copy of the
 * applicant's wording with the pronouns swapped: what a reviewer needs to
 * know from "unknown" is whether the gap is the funder's published rules or
 * the applicant's own record, because only one of those is something they
 * could raise with them.
 *
 * ## Why the unknowns are named as a question rather than a defect
 *
 * A criterion nothing can decide is usually a funder who did not publish the
 * rule, not an applicant who left something out. A reviewer reading "4 rules
 * could not be checked" as a fault would send them back to fix something that
 * is not theirs to fix.
 */

export interface ReviewerEligibility {
  verdict: 'eligible' | 'ineligible' | 'unknown';
  /** How many published criteria were evaluated. */
  checked: number;
  /** How many of those could not be decided. */
  undecided: number;
  /** Whether the applicant's own profile and project are on record at all. */
  applicantKnown: boolean;
}

export interface ReviewerVerdict {
  /** Three words at most, for a badge. */
  label: string;
  /** One sentence, addressed to the reviewer. */
  detail: string;
  /** Which badge this is, so the screen does not re-derive it from the label. */
  tone: 'positive' | 'negative' | 'neutral';
}

export function verdictForReviewer(eligibility: ReviewerEligibility): ReviewerVerdict {
  const { verdict, checked, undecided, applicantKnown } = eligibility;

  if (verdict === 'ineligible') {
    return {
      label: 'Not eligible',
      tone: 'negative',
      detail:
        'On the funder’s published rules and what this organisation has on record, it does not qualify. Worth checking before they spend any more time on it.',
    };
  }

  if (verdict === 'eligible') {
    return {
      label: 'Eligible',
      tone: 'positive',
      detail:
        checked === 1
          ? 'They meet the one criterion this funder publishes.'
          : `They meet all ${checked} criteria this funder publishes.`,
    };
  }

  if (!applicantKnown) {
    return {
      label: 'Not checked',
      tone: 'neutral',
      detail:
        'This organisation’s own details are not on record yet, so nothing could be checked against the funder’s rules.',
    };
  }

  if (checked === 0) {
    return {
      label: 'Nothing to check',
      tone: 'neutral',
      detail:
        'This funder publishes nothing about who can apply, so eligibility could not be checked either way. If you know their rules, that is worth saying.',
    };
  }

  return {
    label: 'Partly checked',
    tone: 'neutral',
    detail:
      undecided === 1
        ? `1 of the ${checked} published criteria cannot be decided from what is on record. Usually a rule the funder left vague rather than something missing here.`
        : `${undecided} of the ${checked} published criteria cannot be decided from what is on record. Usually rules the funder left vague rather than anything missing here.`,
  };
}
