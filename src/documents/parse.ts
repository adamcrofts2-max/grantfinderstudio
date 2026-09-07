/**
 * Turning an uploaded file into text.
 *
 * Everything this module produces is UNTRUSTED. It comes from a file a person
 * downloaded from somewhere, and by the time it reaches the model it must be
 * fenced (see src/ai/untrusted.ts). Nothing here interprets the content; it
 * only decodes it.
 *
 * Text only, deliberately. We do not keep the original bytes: the extracted
 * text is what source spans quote, it is what the confirmation screen shows,
 * and storing it alone means no blob store, no signed URLs and no second copy
 * of an organisation's private documents to lose.
 */

import { extractText, getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';

import { classify, UPLOAD_LIMITS } from './accepted.js';
import type { ParsedPage } from './chunk.js';

// Re-exported so callers that already parse a document need only one import.
// The client-side form imports from './accepted.js' directly, which is what
// keeps the PDF engine out of the browser bundle.
export { ACCEPT_ATTRIBUTE, classify, UPLOAD_LIMITS, type DocumentKind } from './accepted.js';

export class DocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentError';
  }
}

export interface ParsedDocument {
  pages: ParsedPage[];
  /** Null for formats without pages, so nothing invents a page count. */
  pageCount: number | null;
  characters: number;
  truncated: boolean;
}

/** Enforce the character ceiling across pages, keeping whole pages where possible. */
function capped(pages: readonly ParsedPage[]): { pages: ParsedPage[]; truncated: boolean } {
  const kept: ParsedPage[] = [];
  let total = 0;
  for (const page of pages) {
    if (total + page.text.length > UPLOAD_LIMITS.maxCharacters) {
      const room = UPLOAD_LIMITS.maxCharacters - total;
      if (room > 0) kept.push({ pageNumber: page.pageNumber, text: page.text.slice(0, room) });
      return { pages: kept, truncated: true };
    }
    kept.push(page);
    total += page.text.length;
  }
  return { pages: kept, truncated: false };
}

async function parsePdf(bytes: Uint8Array): Promise<ParsedPage[]> {
  const document = await getDocumentProxy(bytes);
  const { text } = await extractText(document, { mergePages: false });
  const perPage = Array.isArray(text) ? text : [text];
  return perPage.map((content, index) => ({ pageNumber: index + 1, text: content }));
}

async function parseDocx(bytes: Uint8Array): Promise<ParsedPage[]> {
  // Word has no fixed pages until it is laid out, so a .docx has no honest
  // page number. Better to record none than to invent one a reader could not
  // find in their own copy.
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return [{ pageNumber: null, text: value }];
}

/**
 * Parse an uploaded file into pages of text.
 *
 * Throws DocumentError with a message safe to show the user; nothing here
 * surfaces a stack trace or a library's internal error to the interface.
 */
export async function parseDocument(
  bytes: Uint8Array,
  filename: string,
  mimeType: string,
): Promise<ParsedDocument> {
  if (bytes.byteLength === 0) throw new DocumentError('That file is empty.');
  if (bytes.byteLength > UPLOAD_LIMITS.maxBytes) {
    throw new DocumentError(
      `That file is larger than ${UPLOAD_LIMITS.maxBytes / (1024 * 1024)} MB.`,
    );
  }

  const kind = classify(filename, mimeType);
  if (kind === null) {
    throw new DocumentError('We can read PDF, Word (.docx), plain text and Markdown files.');
  }

  let pages: ParsedPage[];
  try {
    if (kind === 'pdf') pages = await parsePdf(bytes);
    else if (kind === 'docx') pages = await parseDocx(bytes);
    else pages = [{ pageNumber: null, text: new TextDecoder().decode(bytes) }];
  } catch {
    throw new DocumentError(
      'We could not read that file. It may be password-protected or damaged.',
    );
  }

  const hasPages = kind === 'pdf';
  const normalised = pages.map((page) => ({
    pageNumber: hasPages ? page.pageNumber : null,
    text: page.text,
  }));

  const { pages: kept, truncated } = capped(normalised);
  const characters = kept.reduce((total, page) => total + page.text.trim().length, 0);

  if (characters === 0) {
    throw new DocumentError(
      'That file has no text we can read. If it is a scan, it needs to be run through OCR first.',
    );
  }

  return {
    pages: kept,
    pageCount: hasPages ? pages.length : null,
    characters,
    truncated,
  };
}
