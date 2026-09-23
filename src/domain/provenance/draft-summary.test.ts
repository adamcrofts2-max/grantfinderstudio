import { describe, expect, it } from 'vitest';

import { draftSummary } from './draft-summary.js';

const figures = (over: Partial<Parameters<typeof draftSummary>[0]> = {}) => ({
  wordCount: 20,
  traced: 2,
  unsupported: 0,
  notes: [],
  ...over,
});

describe('what to say about a draft', () => {
  it('never reassures and warns at once', () => {
    // THE property. The product printed "✓ every claim traced to a confirmed
    // fact" directly above "Copy answer (2 unsupported)" and a warning that
    // the highlighted sentences had nothing behind them.
    const said = draftSummary(figures({ unsupported: 2 }));
    expect(said).toContain('could not be supported');
    expect(said).not.toContain('traced to a confirmed fact');
  });

  it('never calls an uncited draft clean', () => {
    // "Every claim traced" is trivially true when nothing was claimed, and
    // reads as praise for prose that states nothing.
    const said = draftSummary(figures({ traced: 0 }));
    expect(said).toContain('states none of your confirmed facts');
    expect(said).not.toMatch(/every claim|all 0 claims/iu);
  });

  it('counts what it traced, rather than asserting "every"', () => {
    expect(draftSummary(figures({ traced: 3 }))).toContain('all 3 claims traced');
    expect(draftSummary(figures({ traced: 2 }))).toContain('both its claims traced');
    expect(draftSummary(figures({ traced: 1 }))).toContain('its one claim traced');
    expect(draftSummary(figures({ traced: 2 }))).not.toContain('all 2');
  });

  it('puts other problems in without the reassurance', () => {
    const said = draftSummary(figures({ notes: ['2 facts are stated more than once.'] }));
    expect(said).toContain('stated more than once');
    expect(said).not.toContain('traced to a confirmed fact');
  });

  it('reports both an unsupported sentence and another problem', () => {
    const said = draftSummary(figures({ unsupported: 1, notes: ['Over the word limit by 30.'] }));
    expect(said).toContain('1 sentence could not be supported');
    expect(said).toContain('Over the word limit');
  });

  it('agrees with the count it was given, always', () => {
    // Whatever the figures, the words and the numbers cannot disagree —
    // which is the whole reason this is one function and not three files.
    for (const traced of [0, 1, 5]) {
      for (const unsupported of [0, 1, 3]) {
        const said = draftSummary(figures({ traced, unsupported }));
        if (unsupported > 0) {
          expect(said).toContain(`${unsupported} sentence`);
          expect(said).not.toContain('traced to a confirmed fact');
        } else if (traced === 0) {
          expect(said).toContain('states none of your confirmed facts');
        } else {
          expect(said).toContain('traced to a confirmed fact');
          expect(said).not.toContain('could not be supported');
        }
      }
    }
  });

  it('counts one word in the singular', () => {
    expect(draftSummary(figures({ wordCount: 1 }))).toContain('Drafted 1 word,');
  });
});
