/**
 * Counting the words in an answer. One definition, for one reason.
 *
 * A funder's limit is the hard edge of an application: over it, portals
 * truncate or refuse. So the number under a text box and the number the
 * Writer checks its own draft against have to be the SAME number — and they
 * were not going to be, because the count lived privately inside
 * `checkDraft`. Two counters would have disagreed by a word on any answer
 * with a line break in it, which is every real answer, and the box would have
 * said 199 while the check said 201.
 *
 * Whitespace-separated, which is what a word limit means to the person who
 * set it and to every portal that enforces one. Not characters, not tokens.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/u).length;
}

/**
 * The longest answer we will store.
 *
 * A bound rather than a judgement about length: the longest funder question
 * anybody has put in front of this asked for 1,000 words, and 20,000
 * characters is several times that. It exists so a paste of an entire
 * document into one box fails with a sentence rather than filling a column.
 */
export const MAX_ANSWER_LENGTH = 20_000;
