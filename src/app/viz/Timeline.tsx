import type { Timeline as TimelineShape } from '@/domain/tracker/timeline';

/**
 * One tracked item's position in time: today at the left, the deadline
 * somewhere along the track, and the work that has to happen before it drawn
 * as a block ending at that deadline.
 *
 * The block's LEFT EDGE is the point of the chart. That is the latest start
 * date — the tracker's central claim, and until now a sentence. Drawn, a group
 * of six reads in one second: how much clear water is left before each one has
 * to be picked up.
 *
 * Every track in a group shares one axis (see `domain/tracker/timeline.ts`),
 * so lengths are comparable down the page rather than each row being scaled to
 * its own deadline.
 *
 * Colour here IS status, so the semantic colours are the correct ones to use —
 * this is not a series. Never coloured by anything else.
 */

export type TimelineTone = 'negative' | 'caution' | 'positive' | 'neutral';

export interface TimelineProps {
  timeline: TimelineShape;
  tone: TimelineTone;
  /** A full sentence for screen readers — the chart says nothing they can hear. */
  description: string;
  /** The right-hand caption: how far off the deadline is. */
  endLabel: string;
}

export function Timeline({ timeline, tone, description, endLabel }: TimelineProps) {
  const { deadlineAt, worksFrom, overrunsTo, overruns, overdue, workUnknown, beyond } = timeline;
  const workWidth = Math.max(deadlineAt - worksFrom, 0);

  return (
    <div className={`tl tl-${tone}`}>
      <div className="tl-track" role="img" aria-label={description}>
        <div className="tl-rail" />

        {overdue ? (
          // Nothing to schedule and no slack to show: the whole axis is past.
          <div className="tl-elapsed" />
        ) : (
          <>
            {/* The stretch of work, ending at the deadline. Zero width when
                nothing is left to write, which is itself the answer. */}
            {workUnknown ? null : (
              <div
                className="tl-work grows"
                style={{ left: `${worksFrom}%`, width: `${workWidth}%` }}
              />
            )}
            {/* Work that lands after the deadline. Striped, and drawn past
                the date rather than clamped to it: a block ending neatly on
                the deadline would read as a perfect fit, which is the exact
                opposite of what has happened. */}
            {overrunsTo === null ? null : (
              <div
                className="tl-overrun"
                style={{ left: `${deadlineAt}%`, width: `${Math.max(overrunsTo - deadlineAt, 0)}%` }}
              />
            )}
            {/* The latest day you can still start. */}
            {workUnknown || overruns || workWidth === 0 ? null : (
              <div className="tl-start" style={{ left: `${worksFrom}%` }} />
            )}
            <div className={beyond ? 'tl-deadline tl-beyond' : 'tl-deadline'}
                 style={{ left: `${deadlineAt}%` }} />
          </>
        )}

        {/* Today is a fixed post at the left of every track in the group. */}
        <div className="tl-today" />
      </div>

      <div className="tl-scale" aria-hidden="true">
        <span>Today</span>
        <span className="tl-end">{endLabel}</span>
      </div>
    </div>
  );
}
