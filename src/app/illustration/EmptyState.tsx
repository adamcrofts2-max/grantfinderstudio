import type { ReactNode } from 'react';

import { CAST, type CastMember } from './cast';

/**
 * An empty state built around a figure rather than an apologetic paragraph.
 *
 * This is where the line characters earn their place. An empty screen is the
 * one moment in the product with nothing to read, nothing to decide and no
 * numbers to compete with — and it is often someone's first minute here. A
 * drawing costs nothing in comprehension and turns "there is nothing here"
 * into the beginning of something.
 *
 * Nowhere else. Beside a chart or a deadline the same drawing is decoration
 * competing with the work.
 */
export function EmptyState({
  title,
  children,
  action,
  figure,
}: {
  title: string;
  /**
   * Which of the cast stands here — chosen per screen, doing that screen's
   * job. One drawing across every empty state wore thin; see `cast.tsx`.
   */
  figure: CastMember;
  children: ReactNode;
  /** The one thing to do next. Empty states without one are just apologies. */
  action?: ReactNode;
}) {
  const Drawing = CAST[figure];
  return (
    <section className="card">
      <div className="empty">
        <div className="figure-stage">
          <Drawing />
        </div>
        <div>
          <h2 className="card-title">{title}</h2>
          <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
            {children}
          </p>
          {action === undefined ? null : (
            <div style={{ marginTop: 'var(--s-4)' }}>{action}</div>
          )}
        </div>
      </div>
    </section>
  );
}
