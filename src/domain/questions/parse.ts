/**
 * Parse questions pasted from a funder's application portal.
 *
 * Almost every UK funder uses their own web form — Grantium, Flexigrant, or
 * something bespoke — so there is nothing to upload. The applicant copies the
 * questions out of that form and pastes them here.
 *
 * The parsing is deterministic rather than model-driven, for three reasons:
 * it is free, it is testable against the shapes real portals produce, and its
 * mistakes are obvious to the person reviewing them. Everything it finds is
 * shown for correction before it is saved, so a misparse costs an edit rather
 * than a wrong draft.
 *
 * Word limits matter more than they look: the Writer is told the limit and
 * readiness checks against it, so a question parsed without its limit is a
 * question drafted blind.
 */

export interface ParsedQuestion {
  position: number;
  question: string;
  /** Null when the funder did not state one, or stated it in characters. */
  wordLimit: number | null;
  /** Supporting text the funder gave beneath the question. */
  guidance: string | null;
}

/**
 * Word limits, in the phrasings portals actually use.
 * Ordered longest-pattern-first so "maximum of 250 words" is not read as "250 words".
 */
const WORD_LIMIT_PATTERNS: readonly RegExp[] = [
  /\bword\s*(?:limit|count)\s*[:\-–]?\s*(\d{2,5})\b/iu,
  /\b(?:max(?:imum)?|up\s+to|no\s+more\s+than|not\s+more\s+than)\s*(?:of\s*)?(\d{2,5})\s*words?\b/iu,
  /\b(\d{2,5})\s*words?\s*(?:max(?:imum)?|or\s+fewer|or\s+less)\b/iu,
  /\((\d{2,5})\s*words?\)/iu,
];

/** Character limits are detected only so they are not mistaken for word limits. */
const CHARACTER_LIMIT = /\b(\d{2,6})\s*char(?:acter)?s?\b/iu;

/** A line that starts a new question: "1.", "2)", "Q3", "Question 4". */
const QUESTION_START =
  /^\s*(?:(?:question|q)\s*)?(\d{1,2})\s*[.):\-–]\s*(?=\S)|^\s*(?:question|q)\s*(\d{1,2})\b\s*/iu;

export function findWordLimit(text: string): number | null {
  for (const pattern of WORD_LIMIT_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      const value = Number(match[1]);
      // A plausible limit. Four-figure limits exist; five-figure ones are a
      // misread of something else, such as a reference number.
      if (Number.isFinite(value) && value >= 10 && value <= 5000) return value;
    }
  }
  return null;
}

export function findCharacterLimit(text: string): number | null {
  const match = CHARACTER_LIMIT.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 50 ? value : null;
}

/** Remove the limit annotation once captured, so it is not left in the question. */
function stripLimits(text: string): string {
  let out = text;
  for (const pattern of WORD_LIMIT_PATTERNS) out = out.replace(pattern, ' ');
  out = out.replace(CHARACTER_LIMIT, ' ');
  return out
    .replace(/\(\s*\)/gu, ' ')
    .replace(/\s*[([]\s*[)\]]\s*/gu, ' ')
    .replaceAll(/\s{2,}/gu, ' ')
    .replace(/\s*[-–—|:]\s*$/u, '')
    .trim();
}

function looksLikeQuestion(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 8) return false;
  return trimmed.endsWith('?') || /\b(?:describe|tell us|explain|outline|what|how|why|who|list)\b/iu.test(trimmed);
}

/**
 * Split pasted text into questions.
 *
 * Three shapes, in order of confidence:
 *   numbered lines               → one question each
 *   blank-line separated blocks  → one question each
 *   neither                      → the whole paste as a single question
 */
export function parseQuestions(pasted: string): ParsedQuestion[] {
  const text = pasted.replaceAll('\r\n', '\n').trim();
  if (text === '') return [];

  const lines = text.split('\n');
  const numberedIndexes = lines
    .map((line, index) => (QUESTION_START.test(line) ? index : -1))
    .filter((index) => index !== -1);

  const blocks: string[] =
    numberedIndexes.length >= 2
      ? numberedIndexes.map((start, i) =>
          lines.slice(start, numberedIndexes[i + 1] ?? lines.length).join('\n'),
        )
      : text
          .split(/\n\s*\n/u)
          .map((block) => block.trim())
          .filter((block) => block !== '');

  const usable = blocks.length > 0 ? blocks : [text];

  return usable
    .map((block, index) => {
      const withoutNumber = block.replace(QUESTION_START, '').trim();
      const blockLines = withoutNumber.split('\n').map((l) => l.trim()).filter((l) => l !== '');
      if (blockLines.length === 0) return null;

      // The question is the first line, unless a later line is the only one
      // that reads like a question.
      let questionLine = blockLines[0]!;
      let rest = blockLines.slice(1);
      if (!looksLikeQuestion(questionLine)) {
        const better = blockLines.findIndex((line) => looksLikeQuestion(line));
        if (better > 0) {
          questionLine = blockLines[better]!;
          rest = [...blockLines.slice(0, better), ...blockLines.slice(better + 1)];
        }
      }

      const wordLimit = findWordLimit(block);
      const characterLimit = wordLimit === null ? findCharacterLimit(block) : null;

      const guidanceParts = rest.map((line) => stripLimits(line)).filter((line) => line !== '');
      if (characterLimit !== null) {
        guidanceParts.push(`The funder states a limit of ${characterLimit} characters.`);
      }

      const question = stripLimits(questionLine);
      if (question === '') return null;

      return {
        position: index + 1,
        question,
        wordLimit,
        guidance: guidanceParts.length > 0 ? guidanceParts.join(' ') : null,
      };
    })
    .filter((q): q is ParsedQuestion => q !== null)
    // Renumber after discards, so positions are consecutive. The array is
    // freshly built here, so assigning in place is safe.
    .map((q, index) => {
      q.position = index + 1;
      return q;
    });
}
