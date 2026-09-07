/**
 * iCalendar export for tracked funding work.
 *
 * The product architecture cut notifications from the MVP, and that decision
 * stands: alerting people about newly discovered opportunities, over a feed we
 * cannot yet source reliably, manufactures noise.
 *
 * Reminders about an organisation's OWN committed work are a different thing.
 * That data is real, it is user-entered, and the person already owns a
 * reminder system that works on their phone at 7am: their calendar. So rather
 * than build a notification channel — which would need authentication, a mail
 * provider and a scheduler we do not have — we hand them a file their calendar
 * already understands, and let it do the reminding.
 *
 * Two events per application, because the deadline alone is the less useful
 * one: the closing date, and the last day work can still start.
 */

const PRODID = '-//Grant Finder Studio//Funding tracker//EN';
const DOMAIN = 'grantfinderstudio';

/** Escape per RFC 5545 §3.3.11. Order matters: backslash first. */
function escapeText(value: string): string {
  return value
    .replace(/\\/gu, '\\\\')
    .replace(/;/gu, '\\;')
    .replace(/,/gu, '\\,')
    .replace(/\r?\n/gu, '\\n');
}

/**
 * Fold to 75 octets per line, continuing with a leading space (RFC 5545 §3.1).
 * Measured in UTF-8 bytes, and never split inside a multi-byte character.
 */
export function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const parts: string[] = [];
  let offset = 0;
  let limit = 75;
  while (offset < bytes.length) {
    let end = Math.min(offset + limit, bytes.length);
    // Back off until the cut lands on a character boundary.
    while (end > offset && end < bytes.length && ((bytes[end] as number) & 0xc0) === 0x80) {
      end -= 1;
    }
    parts.push(bytes.subarray(offset, end).toString('utf8'));
    offset = end;
    limit = 74; // continuation lines carry a leading space
  }
  return parts.join('\r\n ');
}

function toIcsDate(isoDate: string): string {
  return isoDate.replace(/-/gu, '');
}

function toIcsTimestamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/gu, '').slice(0, 15)}Z`;
}

function addOneDay(isoDate: string): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

export interface CalendarEvent {
  /** Stable across exports, so re-importing updates rather than duplicates. */
  uid: string;
  /** All-day event on this date. */
  date: string;
  summary: string;
  description: string;
  url?: string | undefined;
  /** Days before the date to alarm. Omitted for no alarm. */
  alarmDaysBefore?: number | undefined;
}

/**
 * Render events as an iCalendar document.
 *
 * `now` is a parameter so output is deterministic under test; DTSTAMP is the
 * only field that would otherwise change between identical exports.
 */
export function toIcs(events: readonly CalendarEvent[], now: Date = new Date()): string {
  const stamp = toIcsTimestamp(now);
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Funding deadlines',
  ];

  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}@${DOMAIN}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${toIcsDate(event.date)}`,
      `DTEND;VALUE=DATE:${toIcsDate(addOneDay(event.date))}`,
      `SUMMARY:${escapeText(event.summary)}`,
      `DESCRIPTION:${escapeText(event.description)}`,
      'TRANSP:TRANSPARENT',
    );
    if (event.url !== undefined) lines.push(`URL:${escapeText(event.url)}`);
    if (event.alarmDaysBefore !== undefined) {
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `TRIGGER:-P${event.alarmDaysBefore}D`,
        `DESCRIPTION:${escapeText(event.summary)}`,
        'END:VALARM',
      );
    }
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

export interface CalendarSource {
  id: string;
  title: string;
  funderName: string | null;
  deadline: string | null;
  /** Soft dates are labelled in the event itself, never silently hardened. */
  dateIsFirm: boolean;
  latestStart: string | null;
  hoursRemaining: number | null;
  url?: string | undefined;
}

/**
 * Turn tracked work into calendar events.
 *
 * A soft deadline still earns an event — the person needs to know something is
 * happening around then — but its summary says so, so an estimate never sits
 * in their calendar looking like a confirmed date.
 */
export function toCalendarEvents(sources: readonly CalendarSource[]): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  for (const source of sources) {
    const funder = source.funderName === null ? '' : ` (${source.funderName})`;

    if (source.deadline !== null) {
      events.push({
        uid: `${source.id}-deadline`,
        date: source.deadline,
        summary: source.dateIsFirm
          ? `Deadline: ${source.title}${funder}`
          : `Deadline (unconfirmed): ${source.title}${funder}`,
        description: source.dateIsFirm
          ? 'Closing date as published by the funder.'
          : 'This date has not been confirmed by the funder. Check before relying on it.',
        url: source.url,
        alarmDaysBefore: 7,
      });
    }

    if (source.latestStart !== null && source.hoursRemaining !== null && source.hoursRemaining > 0) {
      const hours = Math.round(source.hoursRemaining * 2) / 2;
      events.push({
        uid: `${source.id}-start`,
        date: source.latestStart,
        summary: `Last day to start: ${source.title}${funder}`,
        description: `About ${hours} ${hours === 1 ? 'hour' : 'hours'} of work remain. Starting later than this means finishing in a rush.`,
        url: source.url,
        alarmDaysBefore: 1,
      });
    }
  }

  return events;
}
