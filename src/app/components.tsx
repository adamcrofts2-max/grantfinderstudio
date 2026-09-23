import type { ReactNode } from 'react';
import type { CriterionOutcome } from '@/domain/eligibility/types';
import type { Recommendation } from '@/domain/effort/model';
import type { Decision } from '@/domain/tracker/decision';

export function Card({
  children,
  title,
  subtitle,
}: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
}) {
  return (
    <section className="card">
      {title ? (
        <div className="card-head">
          <h2 className="card-title">{title}</h2>
          {subtitle ? <p className="card-sub">{subtitle}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

const OUTCOME = {
  pass: { label: 'Met', mark: '✓', className: 'badge badge-positive' },
  fail: { label: 'Not met', mark: '✕', className: 'badge badge-negative' },
  unknown: { label: 'Unknown', mark: '?', className: 'badge badge-caution' },
} as const satisfies Record<CriterionOutcome, { label: string; mark: string; className: string }>;

/** Colour is never the only cue — the mark and the word carry it alone. */
export function OutcomeBadge({ outcome }: { outcome: CriterionOutcome }) {
  const style = OUTCOME[outcome];
  return (
    <span className={style.className}>
      <span aria-hidden="true">{style.mark}</span>
      {style.label}
    </span>
  );
}

const RECOMMENDATION = {
  strong: { label: 'Strong opportunity', className: 'pill pill-positive' },
  worth_considering: { label: 'Worth considering', className: 'pill pill-accent' },
  // Not "Only if…": a badge that trails off is not a verdict. What the
  // conditional recommendation means is that something must be checked
  // before the time is worth spending — so it says that.
  conditional: { label: 'Check first', className: 'pill pill-caution' },
  not_recommended: { label: 'Probably not worth it', className: 'pill pill-negative' },
} as const satisfies Record<Recommendation, { label: string; className: string }>;

export function RecommendationPill({ value }: { value: Recommendation }) {
  const style = RECOMMENDATION[value];
  return <span className={style.className}>{style.label}</span>;
}

export function Notice({
  tone,
  children,
}: {
  tone: 'neutral' | 'caution';
  children: ReactNode;
}) {
  return (
    <p className={`notice notice-${tone}`}>
      {tone === 'caution' ? <span aria-hidden="true">⚠</span> : null}
      <span>{children}</span>
    </p>
  );
}

/**
 * How a funder's answer is labelled, wherever it is shown.
 *
 * Here rather than with the tracker because two screens render it — the
 * tracker row and the application list — and a badge reading "Funded" on one
 * and `awarded` on the other is the same fact described two ways, which is how
 * a reader starts wondering whether they are looking at the same thing. The
 * raw enum value is never shown: `no_reply` is a column, not a sentence.
 */
export const DECISION_BADGE = {
  awarded: { label: 'Funded', className: 'badge badge-positive', mark: '✓' },
  rejected: { label: 'Not funded', className: 'badge badge-negative', mark: '✕' },
  no_reply: { label: 'No reply', className: 'badge badge-neutral', mark: '·' },
} as const satisfies Record<Decision, { label: string; className: string; mark: string }>;

export interface DecidedRow {
  decision: Decision;
  decidedOn: string | null;
  amountAwardedGbp: number | null;
  amountRequestedGbp: number | null;
}

/**
 * The one sentence a decided row shows where the schedule's reason would be.
 *
 * An award names the shortfall when there is one. Being cut from twenty
 * thousand to twelve is the single most useful fact about an award and the one
 * a bare "Funded" hides — it is what tells you whether to ask this funder for
 * less next time.
 */
export function decisionLine(row: DecidedRow): string {
  const when = row.decidedOn === null ? '' : ` on ${humanDate(row.decidedOn)}`;
  if (row.decision === 'rejected') return `Turned down${when}.`;
  if (row.decision === 'no_reply') {
    return `Recorded as no reply${when}. Nothing came back, which is not the same as a refusal — this one is not counted against you.`;
  }
  if (row.amountAwardedGbp === null) return `Funded${when}. No amount recorded.`;
  const cut =
    row.amountRequestedGbp !== null && row.amountAwardedGbp < row.amountRequestedGbp
      ? ` of the ${gbp(row.amountRequestedGbp)} asked for`
      : '';
  return `Funded${when} — ${gbp(row.amountAwardedGbp)}${cut}.`;
}

/** A date a British reader can scan: "Mon 30 Nov 2026". */
export function humanDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function gbp(value: number): string {
  return `£${Math.round(value).toLocaleString('en-GB')}`;
}
