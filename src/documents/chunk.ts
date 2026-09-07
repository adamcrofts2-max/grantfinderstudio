/**
 * Splitting a parsed document into chunks.
 *
 * Two jobs, and they pull in the same direction:
 *   - storage, so a span can later be traced back to a page
 *   - extraction, which must send bounded amounts of text to the model
 *
 * Page numbers are carried through rather than discarded. "Your business plan
 * says this" is a weaker answer to an assessor than "page 4 of your business
 * plan says this", and the whole provenance chain is only as good as its
 * weakest link.
 *
 * Pure: no I/O, no model, deterministic.
 */

export interface ParsedPage {
  /** 1-based as a reader would count, or null for a format without pages. */
  pageNumber: number | null;
  text: string;
}

export interface Chunk {
  index: number;
  content: string;
  /** The page this chunk starts on. Null when the format has no pages. */
  pageNumber: number | null;
}

export const CHUNK_CONSTANTS = {
  /**
   * Target characters per chunk. Large enough that a paragraph and its
   * context stay together — a turnover figure and the year it belongs to are
   * usually within a few hundred characters, and splitting them produces a
   * fact nobody can check.
   */
  targetChars: 3000,
  /**
   * Hard ceiling. A single paragraph longer than this is split mid-paragraph
   * rather than sent whole, because an unbounded chunk is an unbounded
   * request.
   */
  maxChars: 4000,
  /**
   * Characters repeated from the end of the previous chunk, so a sentence
   * spanning a boundary is still readable in one of them.
   */
  overlapChars: 200,
} as const;

/** Collapse the whitespace PDF extraction leaves behind, without losing paragraphs. */
export function normaliseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')
    // Three or more newlines mean the same thing as two: a paragraph break.
    .replace(/\n{3,}/gu, '\n\n')
    // Spaces and tabs run together; newlines are structural and survive.
    .replace(/[^\S\n]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .trim();
}

/** Split into paragraphs, then oversized paragraphs into sentences. */
function segments(text: string): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\n{2,}/u)) {
    const trimmed = paragraph.trim();
    if (trimmed === '') continue;
    if (trimmed.length <= CHUNK_CONSTANTS.maxChars) {
      out.push(trimmed);
      continue;
    }
    // Split after sentence-ending punctuation followed by a space.
    //
    // Sized to the target rather than the ceiling: a segment as large as the
    // ceiling leaves no room for the overlap, which would then be dropped on
    // every boundary and the overlap would exist only on paper.
    let buffer = '';
    for (const sentence of trimmed.split(/(?<=[.!?])\s+/u)) {
      if (buffer !== '' && buffer.length + sentence.length + 1 > CHUNK_CONSTANTS.targetChars) {
        out.push(buffer);
        buffer = '';
      }
      // A single sentence over the ceiling is cut on a word boundary. Rare —
      // usually a table or a run-on list — but it must not be unbounded.
      if (sentence.length > CHUNK_CONSTANTS.targetChars) {
        if (buffer !== '') {
          out.push(buffer);
          buffer = '';
        }
        for (const piece of hardWrap(sentence, CHUNK_CONSTANTS.targetChars)) out.push(piece);
        continue;
      }
      buffer = buffer === '' ? sentence : `${buffer} ${sentence}`;
    }
    if (buffer !== '') out.push(buffer);
  }
  return out;
}

function hardWrap(text: string, limit: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const cut = window.lastIndexOf(' ');
    const at = cut > limit / 2 ? cut : limit;
    pieces.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest !== '') pieces.push(rest);
  return pieces;
}

function tail(text: string): string {
  if (CHUNK_CONSTANTS.overlapChars <= 0 || text.length <= CHUNK_CONSTANTS.overlapChars) return '';
  const window = text.slice(-CHUNK_CONSTANTS.overlapChars);
  // Start the overlap at a word boundary so it does not begin mid-word.
  const space = window.indexOf(' ');
  return space === -1 ? window : window.slice(space + 1);
}

/**
 * Turn parsed pages into chunks.
 *
 * Pages are concatenated before splitting, because a paragraph that runs over
 * a page break is one paragraph; the page number recorded is the one the
 * chunk begins on.
 */
export function chunkPages(pages: readonly ParsedPage[]): Chunk[] {
  const chunks: Chunk[] = [];
  let buffer = '';
  let startedOn: number | null = null;

  const flush = (): void => {
    if (buffer.trim() === '') return;
    chunks.push({ index: chunks.length, content: buffer.trim(), pageNumber: startedOn });
    const carry = tail(buffer.trim());
    buffer = carry;
    startedOn = null;
  };

  for (const page of pages) {
    const text = normaliseWhitespace(page.text);
    if (text === '') continue;

    for (const segment of segments(text)) {
      if (buffer !== '' && buffer.length + segment.length + 2 > CHUNK_CONSTANTS.targetChars) {
        flush();
      }
      // The overlap carried from the previous chunk is a convenience, not a
      // guarantee: if keeping it would push this chunk past the hard ceiling,
      // it goes. Segments are already bounded by the ceiling, so dropping the
      // carry is always enough.
      if (buffer !== '' && buffer.length + segment.length + 2 > CHUNK_CONSTANTS.maxChars) {
        buffer = '';
        startedOn = null;
      }
      if (startedOn === null) startedOn = page.pageNumber;
      buffer = buffer === '' ? segment : `${buffer}\n\n${segment}`;
    }
  }

  // The final flush must not leave its own overlap behind as a stub.
  if (buffer.trim() !== '') {
    chunks.push({ index: chunks.length, content: buffer.trim(), pageNumber: startedOn });
  }
  return chunks;
}

/**
 * Group chunks into batches small enough to send to the model in one call.
 *
 * Extraction reads a whole batch at once so a fact and its context are seen
 * together; the batch size is what keeps a 200-page document from becoming a
 * single unbounded request.
 */
export function batchChunks(chunks: readonly Chunk[], maxChars = 12_000): Chunk[][] {
  const batches: Chunk[][] = [];
  let current: Chunk[] = [];
  let size = 0;

  for (const chunk of chunks) {
    if (current.length > 0 && size + chunk.content.length > maxChars) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(chunk);
    size += chunk.content.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Render a batch for the model, keeping page markers so spans stay traceable. */
export function renderBatch(chunks: readonly Chunk[]): string {
  return chunks
    .map((chunk) =>
      chunk.pageNumber === null
        ? chunk.content
        : `[page ${chunk.pageNumber}]\n${chunk.content}`,
    )
    .join('\n\n');
}
