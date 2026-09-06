import type { ReactNode } from 'react';
import type { CriterionOutcome } from '@/domain/eligibility/types';
import type { Recommendation } from '@/domain/effort/model';

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
  conditional: { label: 'Only if…', className: 'pill pill-caution' },
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

export function gbp(value: number): string {
  return `£${Math.round(value).toLocaleString('en-GB')}`;
}
