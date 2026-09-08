import type { ReactNode } from 'react';

import { Figure } from './Figure';

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
}: {
  title: string;
  children: ReactNode;
  /** The one thing to do next. Empty states without one are just apologies. */
  action?: ReactNode;
}) {
  return (
    <section className="card">
      <div className="empty">
        <div className="figure-stage">
          <div className="figure-disc" />
          <div className="figure-art">
            <Figure />
          </div>
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
