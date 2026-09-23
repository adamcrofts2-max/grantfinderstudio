import { describe, expect, it } from 'vitest';

import {
  CONFIRMED_FACTS_NEEDED,
  setupProgress,
  setupSteps,
  type SetupFacts,
} from './progress.js';

/** A confirmed answer to each of the three questions about the work. */
const DESCRIBED = ['mission', 'beneficiary_groups', 'people_supported_last_year'];

const nothing: SetupFacts = {
  hasOrganisation: false,
  hasProject: false,
  confirmedFacts: 0,
  pendingFacts: 0,
  confirmedWorkClaims: [],
  pendingWorkClaims: [],
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
    // Someone who added a fund and a project before describing their work is
    // not sent back to the start; they are sent to the earliest thing still
    // outstanding.
    const p = setupProgress(facts({ hasOrganisation: true, hasProject: true, opportunities: 3 }));
    expect(p.next?.id).toBe('facts');
    expect(p.done).toBe(3);
  });

  it('is complete only when every step is', () => {
    const p = setupProgress(
      facts({
        hasOrganisation: true,
        hasProject: true,
        confirmedFacts: CONFIRMED_FACTS_NEEDED,
        confirmedWorkClaims: DESCRIBED,
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
    const below = setupSteps(
      facts({ confirmedFacts: CONFIRMED_FACTS_NEEDED - 1, confirmedWorkClaims: DESCRIBED }),
    );
    expect(below.find((s) => s.id === 'facts')?.done).toBe(false);
    const at = setupSteps(
      facts({ confirmedFacts: CONFIRMED_FACTS_NEEDED, confirmedWorkClaims: DESCRIBED }),
    );
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
  const stuck = facts({
    hasOrganisation: true,
    hasProject: true,
    confirmedFacts: 2,
    pendingFacts: 0,
    confirmedWorkClaims: DESCRIBED,
  });

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

  it('promises nothing that needs one', () => {
    // The step leads to the funder record now, which needs no model. Its
    // description must not send somebody to paste guidance for a reader
    // this deployment does not have.
    expect(setupSteps(noWriter).find((s) => s.id === 'opportunity')?.why).not.toContain('Paste');
  });

  it('leaves nothing on the whole path that a missing key can block', () => {
    // The product has to be finishable end to end without one.
    for (const step of setupSteps(noWriter)) {
      if (step.blocked !== null) expect(step.blocked, step.id).not.toContain('Anthropic');
    }
  });
});

describe('finding a fund in the first place', () => {
  /**
   * The step said "Add a fund you are considering" and assumed you arrived
   * with one in mind, with finding one as a small underlined link beneath.
   * The person this product is for came to FIND funding and has none — and
   * "see who funds work like yours" is the promise the landing page makes. So
   * finding is the button now, and adding one you already know is the link.
   */
  const readyForAFund: SetupFacts = {
    hasOrganisation: true,
    hasProject: true,
    confirmedFacts: 8,
    pendingFacts: 0,
    confirmedWorkClaims: DESCRIBED,
    pendingWorkClaims: [],
    opportunities: 0,
    applications: 0,
    writerAvailable: false,
  };

  it('leads with finding a fund, not typing one in', () => {
    const step = setupSteps(readyForAFund).find((s) => s.id === 'opportunity')!;
    expect(step.href).toBe('/funders');
    expect(step.action).toMatch(/who funds work like yours/iu);
    expect(step.title).not.toMatch(/^Add a fund/iu);
  });

  it('keeps adding a fund you already know about one click away', () => {
    const step = setupSteps(readyForAFund).find((s) => s.id === 'opportunity')!;
    expect(step.alternative?.href).toBe('/opportunities/add');
    expect(step.alternative?.label).toMatch(/fund in mind/iu);
  });

  it('is finished by adding a fund, not by looking', () => {
    // Browsing funders and finding nobody is not having something to apply
    // to, and the step after this one needs something to apply to.
    expect(setupSteps(readyForAFund).find((s) => s.id === 'opportunity')?.done).toBe(false);
    expect(
      setupSteps({ ...readyForAFund, opportunities: 1 }).find((s) => s.id === 'opportunity')
        ?.done,
    ).toBe(true);
  });

  it('describes the same route with or without a key', () => {
    // The funder record needs no model, so nothing about this step changes
    // on a deployment without one.
    const without = setupSteps(readyForAFund).find((s) => s.id === 'opportunity')!;
    const withKey = setupSteps({ ...readyForAFund, writerAvailable: true }).find(
      (s) => s.id === 'opportunity',
    )!;
    expect(withKey).toEqual(without);
  });

  it('is the step in front of somebody who has done the rest', () => {
    expect(setupProgress(readyForAFund).next?.id).toBe('opportunity');
  });

  it('offers no alternative on the steps that need none', () => {
    const others = setupSteps(readyForAFund).filter((s) => s.id !== 'opportunity');
    expect(others.every((s) => s.alternative === undefined)).toBe(true);
  });
});

describe('the work step', () => {
  /**
   * Setup's first step writes five confirmed facts: legal name, form, number,
   * incorporation date and area. That met the old five-fact gate on its own,
   * so the product declared the Writer ready to write about an organisation
   * whose work it had never been told a word of.
   */
  const identityOnly: SetupFacts = {
    hasOrganisation: true,
    hasProject: false,
    confirmedFacts: 5,
    pendingFacts: 0,
    confirmedWorkClaims: [],
    pendingWorkClaims: [],
    opportunities: 0,
    applications: 0,
    writerAvailable: true,
  };
  const work = (over: Partial<SetupFacts> = {}) =>
    setupSteps({ ...identityOnly, ...over }).find((s) => s.id === 'facts')!;

  it('is not done by five facts about who you are', () => {
    expect(work().done).toBe(false);
  });

  it('comes straight after the organisation', () => {
    // Every form asks about the organisation before the project, and a
    // project is one thing an organisation does.
    expect(setupSteps(identityOnly).map((s) => s.id)).toEqual([
      'organisation',
      'facts',
      'project',
      'opportunity',
      'application',
    ]);
    expect(setupProgress(identityOnly).next?.id).toBe('facts');
  });

  it('asks the three questions, on the page that asks them', () => {
    expect(work().title).toBe('Tell us about your work');
    expect(work().href).toBe('/onboarding#work');
    expect(work().action).toBe('Tell us what you do');
  });

  it('names only what is still missing', () => {
    const step = work({ confirmedWorkClaims: ['mission'] });
    expect(step.action).toBe('Tell us who it is for and how many you reach');
    expect(work({ confirmedWorkClaims: ['mission', 'beneficiary_groups'] }).action).toBe(
      'Tell us how many you reach',
    );
  });

  it('asks about the work even when facts are waiting to be checked', () => {
    // A pile of unconfirmed register facts is not an answer to "what do you
    // do", and sending somebody to confirm them first buries the question.
    expect(work({ pendingFacts: 4 }).href).toBe('/onboarding#work');
  });

  it('sends you to check an answer we already hold, not to type it again', () => {
    // The website reader proposed a mission; it is waiting on Your
    // organisation. Asking for it again on another page is not listening.
    const step = work({ pendingWorkClaims: ['mission', 'beneficiary_groups', 'people_supported_last_year'] });
    expect(step.href).toBe('/organisation');
    expect(step.action).toBe('Check what we found about your work');
  });

  it('asks only what nobody has proposed an answer to', () => {
    const proposed = { ...identityOnly, pendingWorkClaims: ['mission'] };
    expect(setupSteps(proposed).find((s) => s.id === 'facts')?.action).toBe(
      'Tell us who it is for and how many you reach',
    );
    expect(setupProgress(proposed).unansweredAboutTheWork.map((q) => q.id)).toEqual([
      'who',
      'how_many',
    ]);
  });

  it('counts a programme description as saying what you do', () => {
    const step = work({ confirmedWorkClaims: ['programme_description'] });
    expect(step.action).not.toContain('what you do');
  });

  it('is done once the three are answered and the count is met', () => {
    expect(work({ confirmedFacts: 8, confirmedWorkClaims: DESCRIBED }).done).toBe(true);
  });

  it('hands the unanswered questions to the form that asks them', () => {
    const p = setupProgress({ ...identityOnly, confirmedWorkClaims: ['beneficiary_groups'] });
    expect(p.unansweredAboutTheWork.map((q) => q.id)).toEqual(['what', 'how_many']);
  });
});
