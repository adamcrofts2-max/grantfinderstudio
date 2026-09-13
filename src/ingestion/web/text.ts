/**
 * Turning a fetched page into the text an extractor can read.
 *
 * No HTML parser, deliberately. A parser is a dependency with its own
 * vulnerability history, invoked on untrusted input, to produce something we
 * then throw almost all of away. What the extractor needs is prose: the words
 * a funder would read on the page.
 *
 * The order matters. Script and style CONTENT has to go before tags are
 * stripped, or the stripping leaves behind a page's worth of JavaScript for
 * the model to read as if it were the organisation describing itself — which
 * is both useless and the most obvious way to get instructions in front of it.
 */

/** Everything whose content is code or metadata rather than words. */
const CODE_BLOCKS =
  /<(script|style|noscript|template|svg|head)\b[^>]*>[\s\S]*?<\/\1\s*>/giu;

const COMMENTS = /<!--[\s\S]*?-->/gu;
const TAGS = /<[^>]+>/gu;

/**
 * Control characters, except the newline and tab this function inserts.
 *
 * A Unicode property rather than a hand-written character class. The class
 * version had to spell out escapes, and writing it, those escapes ended up in
 * the file as LITERAL control bytes — working code that is invisible in
 * review, which is the whole hazard being guarded against here.
 */
const CONTROL = /(?![\n\t])\p{Cc}/gu;

/** Entities common enough in prose to be worth decoding. */
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&pound;': '£',
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&ldquo;': '“',
  '&rdquo;': '”',
};

/**
 * Paragraph-ish boundaries, so sentences do not run into each other.
 *
 * It matters beyond tidiness: the extractor quotes the span a fact came from,
 * and a span that has swallowed the next heading is not a quote anybody can
 * check against the page.
 */
const BREAKS = /<\/?(p|div|br|li|tr|h[1-6]|section|article|header|footer|td)\b[^>]*>/giu;

export function htmlToText(html: string, maxLength = 20_000): string {
  const text = html
    .replaceAll(COMMENTS, ' ')
    .replaceAll(CODE_BLOCKS, ' ')
    .replaceAll(BREAKS, '\n')
    .replaceAll(TAGS, ' ')
    .replaceAll(/&[a-z#0-9]+;/giu, (entity) => ENTITIES[entity.toLowerCase()] ?? ' ')
    .replaceAll(CONTROL, '')
    // Collapse runs of spaces, then runs of blank lines, in that order.
    .replaceAll(/[^\S\n]+/gu, ' ')
    .replaceAll(/ ?\n ?/gu, '\n')
    .replaceAll(/\n{3,}/gu, '\n\n')
    .trim();

  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;
}

/** Is there enough prose here to be worth asking a model about? */
export function hasEnoughText(text: string): boolean {
  // A page of navigation and a cookie banner is not a description of an
  // organisation, and spending a model call on it produces confident nonsense.
  return text.replaceAll(/\s+/gu, ' ').trim().length >= 200;
}
