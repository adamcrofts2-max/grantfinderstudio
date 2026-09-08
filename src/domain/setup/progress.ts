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

export interface SetupFacts {
  hasOrganisation: boolean;
  hasProject: boolean;
  /** Confirmed facts. The Writer drafts from these and nothing else. */
  confirmedFacts: number;
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
}

/** Below this the Writer will not draft, so the step is not finished. */
export const CONFIRMED_FACTS_NEEDED = 5;

const NEEDS_WRITER =
  'This needs an Anthropic key. Add one in Settings, or ask whoever runs this ' +
  'deployment to set one for everybody.';

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

function build(facts: SetupFacts): SetupStep[] {
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
    {
      id: 'project',
      title: 'Say what you are trying to fund',
      why: 'The amount you need, how long for and who it is for are checked against every fund’s rules — and marked on the charts, so you can see whether your ask is the size that funder actually gives.',
      done: facts.hasProject,
      href: '/onboarding',
      action: facts.hasProject ? 'Review' : 'Add your project',
      blocked: null,
    },
    {
      id: 'facts',
      title: 'Confirm the facts about your organisation',
      why: `The Writer drafts only from facts you have confirmed. Below ${CONFIRMED_FACTS_NEEDED} it will not draft at all, and every answer stays yours to write from a blank box.`,
      done: facts.confirmedFacts >= CONFIRMED_FACTS_NEEDED,
      href: '/organisation',
      action: facts.confirmedFacts === 0 ? 'Add your facts' : 'Confirm the rest',
      blocked: null,
    },
    {
      id: 'opportunity',
      title: 'Add a fund you are considering',
      why: 'Nobody publishes a list of open UK trust funds. Paste a funder’s own guidance and we read it into an eligibility check, a deadline, and an estimate of the work.',
      done: facts.opportunities > 0,
      href: '/opportunities/add',
      action: 'Add a fund',
      blocked: facts.writerAvailable ? null : NEEDS_WRITER,
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
  };
}
