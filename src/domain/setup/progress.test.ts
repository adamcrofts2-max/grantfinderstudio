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
  pendingFacts: 0,
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
    // "Add a fund · done" beside a blocker is the product contradicting
    // itself. A blocker is about doing a thing, not having done it. This
    // combination reached a screenshot before it was caught.
    const done = setupSteps(
      facts({ writerAvailable: false, opportunities: 2, applications: 1 }),
    );
    for (const step of done) {
      if (step.done) expect(step.blocked, step.id).toBeNull();
    }
    expect(done.find((s) => s.id === 'opportunity')?.done).toBe(true);
  });

  it('still blocks the step when it is NOT done', () => {
    const step = setupSteps(facts()).find((s) => s.id === 'application');
    expect(step?.done).toBe(false);
    expect(step?.blocked).toContain('Add a fund first');
  });
});

describe('the facts step, when there is nothing waiting to be checked', () => {
  // The dead end this was written for: the guide said "confirm the rest", the
  // page it pointed at said "Everything is checked", and the counter could
  // never move.
  const stuck = facts({ hasOrganisation: true, hasProject: true, confirmedFacts: 2, pendingFacts: 0 });

  it('does not tell you to confirm what does not exist', () => {
    const step = setupSteps(stuck).find((s) => s.id === 'facts');
    expect(step?.action).not.toBe('Confirm the rest');
    expect(step?.href).toBe('/organisation#add-fact');
  });

  it('says how many are still needed, in the button', () => {
    const step = setupSteps(stuck).find((s) => s.id === 'facts');
    expect(step?.action).toContain(`2 of ${CONFIRMED_FACTS_NEEDED}`);
  });

  it('is never blocked, because typing a fact needs no key', () => {
    // It used to point at Settings when there was no writer. There is now a
    // route that works without one, and telling somebody to go and configure
    // an API key to solve a problem they do not have is worse than saying
    // nothing.
    expect(setupSteps({ ...stuck, writerAvailable: false }).find((s) => s.id === 'facts')?.blocked)
      .toBeNull();
    expect(setupSteps(stuck).find((s) => s.id === 'facts')?.blocked).toBeNull();
  });

  it('sends you to the checking page when something IS waiting', () => {
    const step = setupSteps({ ...stuck, pendingFacts: 4 }).find((s) => s.id === 'facts');
    expect(step?.href).toBe('/organisation');
    expect(step?.action).toBe('Confirm the rest');
  });

  it('is not blocked once it is done, however few are waiting', () => {
    const step = setupSteps({ ...stuck, confirmedFacts: CONFIRMED_FACTS_NEEDED }).find(
      (s) => s.id === 'facts',
    );
    expect(step?.done).toBe(true);
    expect(step?.blocked).toBeNull();
  });
});

describe('adding a fund, on a deployment with no key', () => {
  const noWriter = facts({ hasOrganisation: true, hasProject: true, writerAvailable: false });

  it('is not blocked — typing one in works without a key', () => {
    expect(setupSteps(noWriter).find((s) => s.id === 'opportunity')?.blocked).toBeNull();
  });

  it('describes the route that actually exists', () => {
    const step = setupSteps(noWriter).find((s) => s.id === 'opportunity');
    expect(step?.why).toContain('Type in the one you are looking at');
    expect(step?.why).not.toContain('Paste');
  });

  it('offers the reader when there is a key for it', () => {
    const step = setupSteps({ ...noWriter, writerAvailable: true }).find(
      (s) => s.id === 'opportunity',
    );
    expect(step?.why).toContain('Paste');
  });

  it('leaves nothing on the whole path that a missing key can block', () => {
    // The product has to be finishable end to end without one.
    for (const step of setupSteps(noWriter)) {
      if (step.blocked !== null) expect(step.blocked, step.id).not.toContain('Anthropic');
    }
  });
});
