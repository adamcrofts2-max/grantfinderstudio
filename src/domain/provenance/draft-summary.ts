/**
 * What to say about a draft, once it has been checked.
 *
 * A pure function because this is a product decision, not plumbing — and
 * because the bug it exists to prevent was a sentence that could not be tested
 * where it lived. In one card the product said:
 *
 *   ✓ Drafted 20 words, every claim traced to a confirmed fact.
 *   Copy answer (2 unsupported)
 *   ⚠ Highlighted sentences have nothing behind them.
 *
 * All three at once. The summary counted one thing, the highlighting counted
 * another, and each was computed in a different file. For a product whose
 * entire claim is honest provenance there is no worse place for a
 * contradiction — and it would have shown on nearly every real draft, because
 * prose has connecting sentences and the Writer is told to leave those
 * uncited.
 *
 * So the count and the sentence come from here, together, and a test can hold
 * them to each other.
 */

export interface DraftFigures {
  wordCount: number;
  /** Sentences citing a fact that resolves. */
  traced: number;
  /** Sentences citing a fact that does NOT resolve. Never the uncited ones. */
  unsupported: number;
  /** Anything else worth saying: over the limit, a fact stated twice. */
  notes: readonly string[];
}

export function draftSummary(figures: DraftFigures): string {
  const { wordCount, traced, unsupported, notes } = figures;
  const words = `Drafted ${wordCount} word${wordCount === 1 ? '' : 's'}`;

  // Problems first, and nothing reassuring alongside them.
  if (unsupported > 0 || notes.length > 0) {
    const all = [
      ...(unsupported > 0
        ? [
            `${unsupported} sentence${unsupported === 1 ? '' : 's'} could not be supported and ${unsupported === 1 ? 'is' : 'are'} marked below.`,
          ]
        : []),
      ...notes,
    ];
    return `${words}. ${all.join(' ')}`;
  }

  /**
   * Nothing cited is not a clean bill of health.
   *
   * "Every claim traced to a confirmed fact" is satisfied trivially when there
   * were no claims — which reads as praise for prose that states nothing. The
   * first fix for the contradiction above introduced exactly that, which is
   * the same fault wearing different clothes: a true sentence about the wrong
   * thing.
   */
  if (traced === 0) {
    return `${words}, but it states none of your confirmed facts — check that it answers the question.`;
  }

  return `${words}, ${traced === 1 ? 'its one claim' : `all ${traced} claims`} traced to a confirmed fact.`;
}
