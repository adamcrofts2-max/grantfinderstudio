import type { ReactNode } from 'react';

/**
 * Annotation marks — the product's visual signature.
 *
 * A bid writer reads a draft with a highlighter and a pen. These do the same
 * to the reader's own situation: they mark the one thing the product worked
 * out, so it stops being another sentence in a paragraph of sentences.
 *
 * All three are decoration and are hidden from assistive technology. The words
 * underneath already say everything the mark says — that is the test for
 * whether a mark has earned its place. If removing it loses information, it
 * was carrying meaning it should not have been.
 */

/**
 * A highlighter swipe behind a run of text.
 *
 * TITLES AND MARKETING ONLY. Never inside a card that carries a status badge:
 * a yellow wash next to an amber "Behind" badge starts reading as a warning,
 * and the four status colours have to keep meaning exactly one thing.
 *
 * Reserve it for a title that reports a FINDING — "Nothing is slipping",
 * "3 things need your attention". A swipe behind "Settings" marks nothing.
 */
export function Highlight({ children }: { children: ReactNode }) {
  return (
    <span className="hl-wrap">
      <svg
        className="hl"
        viewBox="0 0 400 60"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        {/* Uneven on purpose: a clean rectangle reads as a background colour
            rather than as a mark somebody made. Distortion from the stretch is
            invisible on a shape with no true edges. */}
        <path
          d="M5,13 C70,5 150,10 210,7 C280,4 340,12 396,8 L394,50 C330,56 250,47 180,52
             C120,56 60,49 6,53 Z"
          fill="var(--hl)"
        />
      </svg>
      <span className="hl-t">{children}</span>
    </span>
  );
}

/**
 * A pen circle around the value the reader came for.
 *
 * Drawn in ink rather than highlighter, so it can sit inside a working card
 * without competing with a status badge. Use it once per card at most — a
 * page with four circled things has circled nothing.
 */
export function Circled({ children }: { children: ReactNode }) {
  return (
    <span className="circled">
      <svg viewBox="0 0 240 64" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        {/* The overshoot at the end is what makes it read as drawn rather than
            as a border-radius. */}
        <path
          d="M44,10 C104,2 196,6 226,20 C238,26 232,48 190,57 C140,67 58,64 24,52
             C6,45 8,22 44,10 C54,7 68,5 82,4"
          fill="none"
          stroke="var(--mark)"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      </svg>
      <span className="circled-t">{children}</span>
    </span>
  );
}

/**
 * The note in the margin that the circle points at.
 *
 * Small caps, not a handwriting face. The drawn arrow carries the annotation
 * feel; a fake hand on top of it would tip the whole thing into novelty, and
 * this product is read by someone deciding how to spend twenty evenings.
 */
export function MarginNote({
  children,
  align = 'start',
}: {
  children: ReactNode;
  /**
   * Which end of the line the note sits at, so the arrow points AT the thing
   * it labels. A right-pointing arrow anchored at the left of a track whose
   * mark is also at the left points away from its subject — which is worse
   * than no arrow at all.
   */
  align?: 'start' | 'end';
}) {
  return (
    <p className={align === 'end' ? 'annot annot-end' : 'annot'}>
      <svg className="annot-arrow" viewBox="0 0 40 18" aria-hidden="true" focusable="false">
        <path
          d="M2,14 C12,12 24,7 36,5 M36,5 L28,2 M36,5 L29,11"
          fill="none"
          stroke="var(--mark)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {children}
    </p>
  );
}
