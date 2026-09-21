import { categoryLabel, isCostCategory } from '../budget/categories.js';

/**
 * What an audit trail is allowed to say happened.
 *
 * ## Why a closed set rather than a string
 *
 * `audit_logs.action` is a `text` column, and a text column filled from twenty
 * call sites becomes three spellings of the same event — `answer.saved`,
 * `answer_saved`, `savedAnswer` — at which point nothing can be counted,
 * filtered or read as a sentence. The set is closed here, in the domain, for
 * the same reason `COST_CATEGORIES` is: the database cannot tell you what its
 * own strings mean, so something has to.
 *
 * ## Why the label lives next to the action
 *
 * A trail that renders `budget_line.removed` is a log file, not a record
 * somebody reads. Each action carries the sentence a person should see, so a
 * new action cannot be added without deciding how it reads.
 *
 * ## The entity type is DERIVED, never passed
 *
 * `entity_type` is the part before the dot. It was a separate argument for one
 * draft and that is one argument too many: `action: 'answer.saved',
 * entityType: 'answers'` type-checks, writes, and quietly splits the trail in
 * two. Deriving it means there is one fact and no way to disagree with it.
 */

/**
 * Every action, with how it reads.
 *
 * Grouped by what it is about rather than alphabetically, because that is how
 * somebody scanning for a missing one will look.
 */
export const AUDIT_ACTIONS = {
  // The application itself
  'application.started': 'Application started',
  'application.questions_added': 'Questions added from the funder’s form',
  'application.submitted': 'Marked as submitted',
  'application.unsubmitted': 'No longer marked as submitted',

  // Writing
  'answer.saved': 'Answer written',
  'answer.drafted': 'Answer drafted from confirmed facts',

  // The budget and the logic model
  'budget_line.added': 'Budget line added',
  'budget_line.removed': 'Budget line removed',
  'outcome.added': 'Outcome added',
  'outcome.removed': 'Outcome removed',

  // Review
  'review.read': 'Application read by the critic',

  // Sharing it read-only with somebody outside the organisation. All three
  // are here because the share is only lawful if it is audited: who was given
  // access, when it was taken away, and every visit they made.
  'share.created': 'Shared read-only for review',
  'share.revoked': 'Review link withdrawn',
  'share.viewed': 'Read by the reviewer',

  // The organisation's own record
  'fact.added': 'Fact added',
  'fact.confirmed': 'Fact confirmed',
  'fact.corrected': 'Fact corrected',

  // Funds and their rules
  'opportunity.added': 'Fund added',
  'opportunity.removed': 'Fund removed',
  'criterion.verified': 'Eligibility rule verified',
  'criterion.rejected': 'Eligibility rule rejected',

  // Documents
  'document.uploaded': 'Document uploaded',
  'document.removed': 'Document removed',
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export function isAuditAction(value: string): value is AuditAction {
  return Object.hasOwn(AUDIT_ACTIONS, value);
}

/**
 * How an action reads, including one this version has never heard of.
 *
 * A trail is the one table that outlives the code that wrote it: a row written
 * last month by an action since renamed still has to render. The slug is a
 * poor sentence and a much better answer than an empty line or a crash.
 */
export function auditLabel(action: string): string {
  return isAuditAction(action) ? AUDIT_ACTIONS[action] : action;
}

/** The entity an action is about — the part before the dot. */
export function auditEntityType(action: AuditAction): string {
  return action.slice(0, action.indexOf('.'));
}

/**
 * The one extra clause a line is worth, from its metadata.
 *
 * Here rather than in the panel for the same reason the label is: adding an
 * action should mean deciding how it reads, in one place, testable without a
 * browser. Empty string when there is nothing worth adding — a line reads
 * perfectly well as "Outcome removed" with no clause after it, and inventing
 * one to fill the space is how a record becomes padding.
 *
 * Every field read here is SHAPE — a count, an amount, a category, a name the
 * applicant typed themselves. `recordAudit` never writes answer prose, so
 * there is none here to render.
 */
const words = (n: number): string => `${n} word${n === 1 ? '' : 's'}`;

export function auditDetail(action: string, metadata: Record<string, unknown>): string {
  const num = (key: string): number | null => {
    const value = metadata[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const str = (key: string): string | null => {
    const value = metadata[key];
    return typeof value === 'string' && value !== '' ? value : null;
  };

  switch (action) {
    case 'answer.saved': {
      const count = num('wordCount');
      if (count === null) return '';
      const limit = num('wordLimit');
      if (count === 0) return 'cleared';
      return limit === null
        ? words(count)
        : `${words(count)} of ${limit}${count > limit ? ' — over the limit' : ''}`;
    }
    case 'answer.drafted': {
      const count = num('wordCount');
      const grounded = num('grounded');
      const sentences = num('sentences');
      const length = count === null ? null : words(count);
      const traced =
        grounded === null || sentences === null
          ? null
          : `${grounded} of ${sentences} sentences traced to a confirmed fact`;
      return [length, traced].filter((part) => part !== null).join(', ');
    }
    case 'application.questions_added': {
      const added = num('added');
      return added === null ? '' : `${added} question${added === 1 ? '' : 's'}`;
    }
    case 'budget_line.added': {
      const amount = num('amountGbp');
      const category = str('category');
      const money =
        amount === null
          ? null
          : `£${amount.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
      // The category's LABEL, not its id. `metadata` stores the id, because
      // that is the stable thing; a trail line rendering "freelancers" where
      // the budget panel says "Freelancers and contractors" is the same
      // record described two ways, which is how a reader starts wondering
      // whether they are looking at the same row.
      const named = category !== null && isCostCategory(category)
        ? categoryLabel(category)
        : category;
      return [money, named].filter((part) => part !== null).join(' · ');
    }
    case 'review.read': {
      const findings = num('findings');
      const mode = str('mode') === 'red_team' ? 'red team' : 'standard';
      return findings === null
        ? mode
        : `${mode}, ${findings} finding${findings === 1 ? '' : 's'}`;
    }
    case 'fact.added':
      return str('claim') ?? '';
    case 'opportunity.added': {
      const funder = str('funderName');
      const criteria = num('criteria');
      return [
        funder,
        criteria === null ? null : `${criteria} rule${criteria === 1 ? '' : 's'} found`,
      ]
        .filter((part) => part !== null)
        .join(' · ');
    }
    case 'document.uploaded':
      return str('filename') ?? '';
    case 'share.created': {
      // The reviewer's name as the APPLICANT WROTE IT — their own label for
      // their own share, so that "withdrawn" three lines later is legible as
      // being about the same person. Not an address and not verified.
      const who = str('reviewerName');
      const days = num('days');
      return [who, days === null ? null : `${days} days`]
        .filter((part) => part !== null)
        .join(' · ');
    }
    case 'share.revoked':
      return str('reviewerName') ?? '';
    case 'share.viewed': {
      const who = str('reviewerName');
      const visit = num('visit');
      // "Read by the reviewer · Jan, our treasurer" on the first visit, and
      // the visit number after that — a reviewer who came back is a different
      // fact from one who read it once.
      return [who, visit === null || visit <= 1 ? null : `visit ${visit}`]
        .filter((part) => part !== null)
        .join(' · ');
    }
    default:
      return '';
  }
}
