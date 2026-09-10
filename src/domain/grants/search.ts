/**
 * Searching grants that have already been awarded.
 *
 * ## Why this is the centre of the product, not a detail
 *
 * The funder screen answers "who funds work like mine" by summarising a
 * funder's whole record: a median, a range, a count. Useful, and it buried the
 * thing people actually want to see — the GRANTS. An applicant's real question
 * is "who like us has been given money, how much, and by whom", and the answer
 * is a list of award records, each one checkable.
 *
 * All of it is awarded data, published by funders under an open licence and
 * already held. Nothing here is a prediction, and nothing here is an open
 * call: a grant in this list is money that has already gone out. That is
 * precisely why it is worth searching — behaviour is a better guide than a
 * priorities page.
 *
 * Pure and zero I/O, as the rest of the domain. The database does the
 * filtering; this decides WHAT to filter on and how to explain a match, so
 * "similar to my organisation" is a definition somebody can read and test
 * rather than an accident of a WHERE clause.
 */

export interface GrantSearchCriteria {
  /** Free text over recipient name and description. */
  text: string;
  /** County or city as the publisher wrote it. */
  region: string;
  /** Classification label, e.g. "Children and young people". */
  tag: string;
  minAmountGbp: number | null;
  maxAmountGbp: number | null;
}

export const NO_CRITERIA: GrantSearchCriteria = {
  text: '',
  region: '',
  tag: '',
  minAmountGbp: null,
  maxAmountGbp: null,
};

export interface Applicant {
  region: string | null;
  beneficiaryGroups: readonly string[];
  /** What they are asking for, which sets the band worth looking at. */
  amountSoughtGbp: number | null;
}

/**
 * How wide a band around the applicant's ask is worth showing.
 *
 * Half to double. Narrower and a £30,000 ask hides the £18,000 and £55,000
 * grants that tell you the most about whether a funder could stretch;
 * wider and the band stops meaning anything.
 */
export const BAND_LOWER = 0.5;
export const BAND_UPPER = 2;

/**
 * The search somebody should land on: grants like theirs.
 *
 * Derived from what they have already told us, so the first screen is useful
 * before anybody types anything. Every field degrades to "no filter" rather
 * than to a guess — an applicant with no project yet gets every grant, which
 * is honest, rather than a band built around a number they never gave.
 */
export function criteriaLikeMine(applicant: Applicant): GrantSearchCriteria {
  const ask = applicant.amountSoughtGbp;
  return {
    text: '',
    region: applicant.region ?? '',
    // One tag, because the database filter is a single label and picking the
    // first is honest about that. The form lets them change it.
    tag: applicant.beneficiaryGroups[0] ?? '',
    minAmountGbp: ask === null ? null : Math.round(ask * BAND_LOWER),
    maxAmountGbp: ask === null ? null : Math.round(ask * BAND_UPPER),
  };
}

/** Is anything actually being filtered on? */
export function isNarrowed(criteria: GrantSearchCriteria): boolean {
  return (
    criteria.text.trim() !== '' ||
    criteria.region.trim() !== '' ||
    criteria.tag.trim() !== '' ||
    criteria.minAmountGbp !== null ||
    criteria.maxAmountGbp !== null
  );
}

export interface AwardLike {
  amountGbp: number;
  region: string | null;
  tags: readonly string[];
}

/**
 * Why this grant resembles the applicant, in plain terms.
 *
 * Each line points at something countable, the same rule the funder screen
 * follows. No score, and deliberately no ranking by one: a number over
 * heterogeneous published data would imply a precision the data does not have,
 * and an applicant cannot check a score.
 */
export function whySimilar(award: AwardLike, applicant: Applicant): string[] {
  const reasons: string[] = [];

  const region = applicant.region?.trim().toLowerCase();
  if (region !== undefined && region !== '' && award.region !== null) {
    if (award.region.trim().toLowerCase().includes(region)) {
      reasons.push(`Awarded in ${award.region}, where you are.`);
    }
  }

  const groups = applicant.beneficiaryGroups.map((g) => g.trim().toLowerCase());
  const shared = award.tags.filter((tag) =>
    groups.some((group) => group !== '' && tag.toLowerCase().includes(group)),
  );
  if (shared.length > 0) {
    reasons.push(`Classified as ${shared.join(', ')} — what you do.`);
  }

  const ask = applicant.amountSoughtGbp;
  if (ask !== null && ask > 0) {
    const ratio = award.amountGbp / ask;
    if (ratio >= BAND_LOWER && ratio <= BAND_UPPER) {
      reasons.push('Around the size you are asking for.');
    }
  }

  return reasons;
}
