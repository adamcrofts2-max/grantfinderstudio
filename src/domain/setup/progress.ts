/**
 * What a new organisation still has to do.
 *
 * Every step is DERIVED from the database, never from a stored "completed"
 * flag. A flag drifts the moment somebody deletes their project or a migration
 * moves data, and then the product is confidently telling a person they have
 * done something they have not. Deriving it costs one query and cannot lie.
 *
 * Steps are ordered but NOT locked. The order is the order that makes sense;
 * anyone who wants to jump to adding a fund before confirming their facts is
 * an adult and may. A wizard that traps you is a wizard you resent.
 *
 * Pure and zero I/O, like the rest of the domain.
 */

import {
  listOfQuestions,
  unansweredAboutTheWork,
  WORK_QUESTIONS,
  type WorkQuestion,
} from '../provenance/about-the-work.js';

export interface SetupFacts {
  hasOrganisation: boolean;
  hasProject: boolean;
  /** Confirmed facts. The Writer drafts from these and nothing else. */
  confirmedFacts: number;
  /** Facts waiting to be checked. Zero means there is nothing to confirm. */
  pendingFacts: number;
  /** Which claims about the work are confirmed — see `about-the-work`. */
  confirmedWorkClaims: readonly string[];
  /** Which are held but waiting to be checked, e.g. read off a website. */
  pendingWorkClaims: readonly string[];
  opportunities: number;
  applications: number;
  /** Whether the Writer can run at all. Two steps need it. */
  writerAvailable: boolean;
}

export type SetupStepId =
  | 'organisation'
  | 'project'
  | 'facts'
  | 'opportunity'
  | 'application';

export interface SetupStep {
  id: SetupStepId;
  title: string;
  /** WHY it matters, in terms of what the person gets. Never what it does. */
  why: string;
  done: boolean;
  href: string;
  action: string;
  /** Set when the step cannot be completed yet, and says what is missing. */
  blocked: string | null;
  /**
   * A second way through, when the step's own action assumes something the
   * person may not have. Not a substitute for the step — a route to being
   * able to do it.
   */
  alternative?: { label: string; href: string };
}

/**
 * Below this the Writer has too little to ground an answer in, so the step is
 * not finished. Counted AFTER the three questions about the work.
 */
export const CONFIRMED_FACTS_NEEDED = 5;

export function setupSteps(facts: SetupFacts): SetupStep[] {
  // A blocker describes what stands between you and DOING something. Once a
  // step is done it cannot also be blocked, and showing both — "done" beside
  // "this needs an Anthropic key" — reads as the product contradicting itself.
  const steps = build(facts);
  for (const step of steps) {
    if (step.done) step.blocked = null;
  }
  return steps;
}

/**
 * The unanswered questions nobody has proposed an answer to either.
 *
 * A mission the website reader found is waiting on Your organisation to be
 * checked. Asking the person to type it again, on another page, while it sits
 * there is the product not listening — so those are for checking, and only
 * the rest are for asking.
 */
function stillToAsk(facts: SetupFacts): WorkQuestion[] {
  const proposed = new Set(facts.pendingWorkClaims);
  return unansweredAboutTheWork(facts.confirmedWorkClaims).filter(
    (question) => !question.answeredBy.some((claim) => proposed.has(claim)),
  );
}

function build(facts: SetupFacts): SetupStep[] {
  const unanswered = unansweredAboutTheWork(facts.confirmedWorkClaims);
  const toAsk = stillToAsk(facts);
  // Everything missing has an answer waiting to be checked.
  const onlyToCheck = unanswered.length > 0 && toAsk.length === 0;
  return [
    {
      id: 'organisation',
      title: 'Tell us about your organisation',
      why: 'Your legal form and how long you have traded decide which funds you can apply to at all. Getting this exactly right is what makes every eligibility answer trustworthy.',
      done: facts.hasOrganisation,
      href: '/onboarding',
      action: facts.hasOrganisation ? 'Review' : 'Start here',
      blocked: null,
    },
    // Straight after who you ARE, what you DO — before the project, because a
    // project is one thing an organisation does and every form asks about the
    // organisation first.
    //
    // This step used to be "confirm the facts about your organisation", done
    // at five confirmed facts. The organisation step writes five: legal name,
    // form, number, incorporation date and area. So it ticked itself off with
    // nothing about the work at all, and the Writer — which drafts only from
    // confirmed facts — was declared ready to write about an organisation it
    // could not have described in a sentence. The three questions come first
    // now, and the count still applies after them.
    //
    // Never blocked. Typing an answer needs no key, so there is no state in
    // which this step cannot be finished.
    {
      id: 'facts',
      title: 'Tell us about your work',
      why:
        unanswered.length > 0
          ? 'What you do, who it is for and how many people you reach are the first questions on nearly every form. The Writer drafts only from what you have told us, and your name and legal form are not enough for it to write a sentence about your work.'
          : `The Writer drafts only from facts you have confirmed. With fewer than ${CONFIRMED_FACTS_NEEDED} there is too little to ground an answer in, and every answer stays yours to write from a blank box.`,
      done: unanswered.length === 0 && facts.confirmedFacts >= CONFIRMED_FACTS_NEEDED,
      // Two routes to a fact once the three are answered, and this names
      // whichever one is actually in front of the person. When something is
      // waiting to be checked, checking it is the work; when nothing is,
      // "confirm the rest" is an instruction with nothing behind it, so it
      // sends them to the form where they can just say it.
      href: onlyToCheck
        ? '/organisation'
        : toAsk.length > 0
          ? '/onboarding#work'
          : facts.pendingFacts > 0
            ? '/organisation'
            : '/organisation#add-fact',
      action: onlyToCheck
        ? 'Check what we found about your work'
        : toAsk.length > 0
          ? toAsk.length === WORK_QUESTIONS.length
            ? 'Tell us what you do'
            : `Tell us ${listOfQuestions(toAsk)}`
          : facts.pendingFacts > 0
            ? 'Confirm the rest'
            : `Tell us about yourself (${facts.confirmedFacts} of ${CONFIRMED_FACTS_NEEDED})`,
      blocked: null,
    },
    {
      id: 'project',
      title: 'Say what you are trying to fund',
      why: 'The amount you need, how long for and who it is for are checked against every fund’s rules — and marked on the charts, so you can see whether your ask is the size that funder actually gives.',
      done: facts.hasProject,
      href: '/onboarding#project',
      action: facts.hasProject ? 'Review' : 'Add your project',
      blocked: null,
    },
    // Finding comes first, adding second. This step used to be "Add a fund
    // you are considering", with finding one as a small underlined link
    // beneath — the right order for somebody who arrives with a fund in mind,
    // and the wrong one for the person the product is for, who came to FIND
    // funding and has none. "See who funds work like yours" is the promise the
    // landing page makes; it should be the button.
    //
    // Still done by ADDING a fund: browsing funders and finding nobody is not
    // having a fund to apply to, and the next step needs one.
    //
    // Also never blocked. Having guidance read for you needs a key; typing in
    // a fund does not, and neither does the funder record.
    {
      id: 'opportunity',
      title: 'Find a fund worth going for',
      why: 'Nobody publishes a list of open UK trust funds. What funders have already given is public, and it is a better guide than their priorities page — so we start from who has funded work like yours, where you are, at the size you are asking for.',
      done: facts.opportunities > 0,
      href: '/funders',
      action: 'See who funds work like yours',
      blocked: null,
      alternative: {
        label: 'Already have a fund in mind? Add it',
        href: '/opportunities/add',
      },
    },
    {
      id: 'application',
      title: 'Start an application',
      why: 'Paste the funder’s questions and the work becomes visible: roughly how many hours, the last day you could still start, and which claims have no confirmed fact behind them.',
      done: facts.applications > 0,
      href: '/',
      action: 'Open an opportunity',
      blocked:
        facts.opportunities === 0
          ? 'Add a fund first — there is nothing to apply to yet.'
          : null,
    },
  ];
}

export interface SetupProgress {
  steps: SetupStep[];
  done: number;
  total: number;
  /** The first unfinished step, or null when there is nothing left. */
  next: SetupStep | null;
  complete: boolean;
  /**
   * The questions about the work to ASK, for the form that asks them: not
   * answered, and with no proposed answer waiting to be checked.
   */
  unansweredAboutTheWork: WorkQuestion[];
}

export function setupProgress(facts: SetupFacts): SetupProgress {
  const steps = setupSteps(facts);
  const done = steps.filter((step) => step.done).length;
  return {
    steps,
    done,
    total: steps.length,
    next: steps.find((step) => !step.done) ?? null,
    complete: done === steps.length,
    unansweredAboutTheWork: stillToAsk(facts),
  };
}
