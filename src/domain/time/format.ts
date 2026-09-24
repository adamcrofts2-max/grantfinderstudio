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

const WEEKDAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const;

/**
 * "16 November 2026" — the one date style in the product.
 *
 * `weekday` adds the day's name, "Monday 16 November 2026", for the one place
 * it is information rather than decoration: a deadline on a planning screen,
 * where a Sunday deadline means Friday. There used to be a second style
 * ("Mon, 16 Nov 2026", from the browser's locale data) on the tracker and
 * this one everywhere else; a date written two ways in one product reads as
 * two different kinds of date.
 *
 * Anything that is not YYYY-MM-DD comes back unchanged.
 */
export function formatDate(isoDate: string, { weekday = false } = {}): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  const name = MONTHS[Number(month) - 1];
  if (year === undefined || day === undefined || name === undefined) return isoDate;
  const plain = `${Number(day)} ${name} ${year}`;
  if (!weekday) return plain;
  // UTC throughout: a date has no time zone, and local midnight in the
  // server's zone can fall on the previous day.
  const dayOfWeek = WEEKDAYS[new Date(`${isoDate.slice(0, 10)}T00:00:00Z`).getUTCDay()];
  return dayOfWeek === undefined ? plain : `${dayOfWeek} ${plain}`;
}
