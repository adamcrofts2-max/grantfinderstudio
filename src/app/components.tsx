import type { ReactNode } from 'react';
import type { CriterionOutcome } from '@/domain/eligibility/types';
import type { Recommendation } from '@/domain/effort/model';

export function Card({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <section
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: '10px',
        padding: '1.25rem 1.5rem',
        marginBottom: '1rem',
      }}
    >
      {title ? (
        <h2
          style={{
            fontSize: '0.75rem',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--ink-soft)',
            margin: '0 0 0.85rem',
            fontWeight: 700,
          }}
        >
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  );
}

const OUTCOME_STYLE: Record<
  CriterionOutcome,
  { label: string; mark: string; fg: string; bg: string }
> = {
  pass: { label: 'Met', mark: '✓', fg: 'var(--positive)', bg: 'var(--positive-bg)' },
  fail: { label: 'Not met', mark: '✕', fg: 'var(--negative)', bg: 'var(--negative-bg)' },
  unknown: { label: 'Unknown', mark: '?', fg: 'var(--caution)', bg: 'var(--caution-bg)' },
};

/**
 * A criterion outcome. Colour is never the only cue: the mark and the word
 * carry the meaning on their own.
 */
export function OutcomeBadge({ outcome }: { outcome: CriterionOutcome }) {
  const style = OUTCOME_STYLE[outcome];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        background: style.bg,
        color: style.fg,
        borderRadius: '999px',
        padding: '0.15rem 0.6rem',
        fontSize: '0.78rem',
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden="true">{style.mark}</span>
      {style.label}
    </span>
  );
}

const RECOMMENDATION_STYLE: Record<
  Recommendation,
  { label: string; fg: string; bg: string }
> = {
  strong: { label: 'Strong opportunity', fg: 'var(--positive)', bg: 'var(--positive-bg)' },
  worth_considering: { label: 'Worth considering', fg: 'var(--accent)', bg: 'var(--accent-bg)' },
  conditional: { label: 'Only if…', fg: 'var(--caution)', bg: 'var(--caution-bg)' },
  not_recommended: { label: 'Probably not worth it', fg: 'var(--negative)', bg: 'var(--negative-bg)' },
};

export function RecommendationBadge({ value }: { value: Recommendation }) {
  const style = RECOMMENDATION_STYLE[value];
  return (
    <span
      style={{
        display: 'inline-block',
        background: style.bg,
        color: style.fg,
        borderRadius: '6px',
        padding: '0.3rem 0.7rem',
        fontSize: '0.82rem',
        fontWeight: 700,
      }}
    >
      {style.label}
    </span>
  );
}

export function Notice({ tone, children }: { tone: 'neutral' | 'caution'; children: ReactNode }) {
  return (
    <p
      style={{
        margin: '0.35rem 0',
        fontSize: '0.88rem',
        color: tone === 'caution' ? 'var(--caution)' : 'var(--ink-soft)',
        fontWeight: tone === 'caution' ? 600 : 400,
      }}
    >
      {tone === 'caution' ? <span aria-hidden="true">⚠ </span> : null}
      {children}
    </p>
  );
}

export function gbp(value: number): string {
  return `£${Math.round(value).toLocaleString('en-GB')}`;
}
