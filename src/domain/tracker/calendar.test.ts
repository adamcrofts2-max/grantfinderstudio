import { describe, expect, it } from 'vitest';

import { foldLine, toCalendarEvents, toIcs, type CalendarSource } from './calendar.js';

const uids = (text: string) => text.match(/^UID:.*$/gmu);

const NOW = new Date('2026-09-07T09:30:00Z');

function source(overrides: Partial<CalendarSource> = {}): CalendarSource {
  return {
    id: 'app_1',
    title: 'Fictional Youth Futures Fund',
    funderName: 'Fictional Youth Trust',
    deadline: '2026-11-30',
    dateIsFirm: true,
    latestStart: '2026-11-14',
    hoursRemaining: 8,
    url: 'https://example.org/fund',
    ...overrides,
  };
}

describe('foldLine', () => {
  it('leaves a short line alone', () => {
    expect(foldLine('SUMMARY:Short')).toBe('SUMMARY:Short');
  });

  it('folds a long line with a leading space on continuations', () => {
    const folded = foldLine(`SUMMARY:${'a'.repeat(200)}`);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]).toHaveLength(75);
    for (const part of parts.slice(1)) expect(part.startsWith(' ')).toBe(true);
    // Unfolding must give the original back.
    expect(folded.replace(/\r\n /gu, '')).toBe(`SUMMARY:${'a'.repeat(200)}`);
  });

  it('never splits a multi-byte character', () => {
    const line = `SUMMARY:${'é'.repeat(80)}`;
    const folded = foldLine(line);
    expect(folded.replace(/\r\n /gu, '')).toBe(line);
    expect(folded).not.toContain('�');
  });
});

describe('toIcs', () => {
  it('produces a well-formed calendar', () => {
    const ics = toIcs(toCalendarEvents([source()]), NOW);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('DTSTAMP:20260907T093000Z');
  });

  it('uses CRLF line endings throughout', () => {
    const ics = toIcs(toCalendarEvents([source()]), NOW);
    expect(ics).not.toMatch(/[^\r]\n/u);
  });

  it('writes all-day events with an exclusive end date', () => {
    const ics = toIcs(toCalendarEvents([source()]), NOW);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261130');
    expect(ics).toContain('DTEND;VALUE=DATE:20261201');
  });

  it('escapes commas, semicolons and backslashes in text', () => {
    const ics = toIcs(
      toCalendarEvents([source({ title: 'Arts; Culture, and Heritage \\ Fund' })]),
      NOW,
    );
    expect(ics).toContain('Arts\\; Culture\\, and Heritage \\\\ Fund');
  });

  it('gives every event a stable identifier so re-importing updates in place', () => {
    const first = toIcs(toCalendarEvents([source()]), NOW);
    const later = toIcs(toCalendarEvents([source()]), new Date('2026-09-08T00:00:00Z'));
    expect(uids(first)).toEqual(uids(later));
    expect(uids(first)).toContain('UID:app_1-deadline@grantfinderstudio');
  });

  it('opens and closes every event block', () => {
    const ics = toIcs(toCalendarEvents([source(), source({ id: 'app_2' })]), NOW);
    expect(ics.match(/BEGIN:VEVENT/gu)).toHaveLength(4);
    expect(ics.match(/END:VEVENT/gu)).toHaveLength(4);
  });

  it('is a valid empty calendar when there is nothing tracked', () => {
    const ics = toIcs([], NOW);
    expect(ics).not.toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VCALENDAR');
  });
});

describe('toCalendarEvents', () => {
  it('creates a deadline event and a last-day-to-start event', () => {
    const events = toCalendarEvents([source()]);
    expect(events).toHaveLength(2);
    expect(events[0]?.summary).toContain('Deadline:');
    expect(events[1]?.summary).toContain('Last day to start:');
    expect(events[1]?.date).toBe('2026-11-14');
  });

  it('names the funder alongside the fund', () => {
    expect(toCalendarEvents([source()])[0]?.summary).toContain('Fictional Youth Trust');
  });

  it('labels an unconfirmed date in the summary, not only the description', () => {
    // The summary is all most people see in a month view.
    const events = toCalendarEvents([source({ dateIsFirm: false })]);
    expect(events[0]?.summary).toContain('unconfirmed');
    expect(events[0]?.description).toContain('not been confirmed');
  });

  it('omits the start event once the writing is finished', () => {
    const events = toCalendarEvents([source({ hoursRemaining: 0 })]);
    expect(events).toHaveLength(1);
    expect(events[0]?.summary).toContain('Deadline:');
  });

  it('omits the start event when the size of the form is unknown', () => {
    const events = toCalendarEvents([source({ hoursRemaining: null, latestStart: null })]);
    expect(events).toHaveLength(1);
  });

  it('produces nothing for a fund with no date at all', () => {
    expect(
      toCalendarEvents([source({ deadline: null, latestStart: null })]),
    ).toHaveLength(0);
  });

  it('sets a reminder ahead of each date', () => {
    const events = toCalendarEvents([source()]);
    expect(events[0]?.alarmDaysBefore).toBe(7);
    expect(events[1]?.alarmDaysBefore).toBe(1);
    expect(toIcs(events, NOW)).toContain('TRIGGER:-P7D');
  });
});

describe('a title that tries to start a new line', () => {
  /**
   * Found by the September 2026 security review. The escaper turned CRLF and
   * LF into the two-character sequence \\n, but a carriage return on its own
   * went through untouched — and several calendar programs treat a bare CR as
   * the end of a line. A fund title is typed by the applicant, so the person
   * who could exploit it is mostly the person downloading the file; it is
   * fixed because the escaper's whole job is that no input starts a property.
   */
  const injected = 'Innocent Fund\rBEGIN:VEVENT\rSUMMARY:Injected';

  it('leaves no raw carriage return anywhere but the line endings', () => {
    const ics = toIcs(toCalendarEvents([source({ title: injected })]), NOW);
    // Every CR in the file must be the first half of a CRLF line ending.
    expect(ics.replace(/\r\n/gu, '')).not.toMatch(/\r/u);
  });

  it('cannot open a second event from inside a title', () => {
    const ics = toIcs(toCalendarEvents([source({ title: injected })]), NOW);
    const lines = ics.split('\r\n');
    expect(lines.filter((line) => line === 'BEGIN:VEVENT').length).toBe(
      toCalendarEvents([source({ title: injected })]).length,
    );
  });
});
