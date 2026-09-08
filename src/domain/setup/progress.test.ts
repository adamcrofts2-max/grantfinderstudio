import { describe, expect, it } from 'vitest';

import {
  CONFIRMED_FACTS_NEEDED,
  setupProgress,
  setupSteps,
  type SetupFacts,
} from './progress.js';

const nothing: SetupFacts = {
  hasOrganisation: false,
  hasProject: false,
  confirmedFacts: 0,
  opportunities: 0,
  applications: 0,
  writerAvailable: true,
};
const facts = (over: Partial<SetupFacts> = {}): SetupFacts => ({ ...nothing, ...over });

describe('setupProgress', () => {
  it('starts a new account at nothing done, pointing at the first step', () => {
    const p = setupProgress(nothing);
    expect(p.done).toBe(0);
    expect(p.complete).toBe(false);
    expect(p.next?.id).toBe('organisation');
  });

  it('points at the first UNFINISHED step, not the first undone one after a gap', () => {
    // Someone who added a fund before confirming facts is not sent back to
    // the start; they are sent to the earliest thing still outstanding.
    const p = setupProgress(facts({ hasOrganisation: true, opportunities: 3 }));
    expect(p.next?.id).toBe('project');
    expect(p.done).toBe(2);
  });

  it('is complete only when every step is', () => {
    const p = setupProgress(
      facts({
        hasOrganisation: true,
        hasProject: true,
        confirmedFacts: CONFIRMED_FACTS_NEEDED,
        opportunities: 1,
        applications: 1,
      }),
    );
    expect(p.complete).toBe(true);
    expect(p.next).toBeNull();
  });
});

describe('the facts step', () => {
  it('is not done below the threshold the Writer needs', () => {
    // Not an arbitrary number: below it the Writer refuses to draft, so
    // calling the step finished would be a lie about what happens next.
    const below = setupSteps(facts({ confirmedFacts: CONFIRMED_FACTS_NEEDED - 1 }));
    expect(below.find((s) => s.id === 'facts')?.done).toBe(false);
    const at = setupSteps(facts({ confirmedFacts: CONFIRMED_FACTS_NEEDED }));
    expect(at.find((s) => s.id === 'facts')?.done).toBe(true);
  });
});

describe('steps that cannot be done yet say so', () => {
  it('flags adding a fund when there is no Writer', () => {
    const step = setupSteps(facts({ writerAvailable: false })).find(
      (s) => s.id === 'opportunity',
    );
    expect(step?.blocked).toContain('Anthropic key');
  });

  it('does not flag it when the Writer is available', () => {
    expect(setupSteps(facts()).find((s) => s.id === 'opportunity')?.blocked).toBeNull();
  });

  it('flags starting an application before any fund exists', () => {
    expect(setupSteps(facts()).find((s) => s.id === 'application')?.blocked).toContain(
      'Add a fund first',
    );
  });

  it('stops flagging it once a fund exists', () => {
    const step = setupSteps(facts({ opportunities: 1 })).find((s) => s.id === 'application');
    expect(step?.blocked).toBeNull();
  });

  it('never shows a blocker on a step that is done', () => {
    // "Add a fund · done" beside "this needs an Anthropic key" is the product
    // contradicting itself. A blocker is about doing a thing, not having done
    // it. This combination reached a screenshot before it was caught.
    const done = setupSteps(
      facts({ writerAvailable: false, opportunities: 2, applications: 1 }),
    );
    for (const step of done) {
      if (step.done) expect(step.blocked, step.id).toBeNull();
    }
    expect(done.find((s) => s.id === 'opportunity')?.done).toBe(true);
  });

  it('still blocks the step when it is NOT done', () => {
    const step = setupSteps(facts({ writerAvailable: false })).find(
      (s) => s.id === 'opportunity',
    );
    expect(step?.done).toBe(false);
    expect(step?.blocked).toContain('Anthropic key');
  });
});
