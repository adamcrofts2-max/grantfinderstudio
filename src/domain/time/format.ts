/**
 * Dates as a person reads them.
 *
 * Moved here from the tracker once the assessment and the prospect matcher
 * needed it too: "Last retrieved 2026-09-23" was the September walk's
 * complaint, and an ISO date inside a sentence reads like a leak from the
 * database. Pure, deterministic and locale-free, so a date in a sentence
 * reads the same on every machine and in every test.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** "16 November 2026". Anything that is not YYYY-MM-DD comes back unchanged. */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  const name = MONTHS[Number(month) - 1];
  if (year === undefined || day === undefined || name === undefined) return isoDate;
  return `${Number(day)} ${name} ${year}`;
}
