/**
 * What we accept, and the limits on it.
 *
 * Deliberately free of any parsing dependency. The upload form in the browser
 * needs these constants, and if they lived beside the PDF and Word parsers
 * every visitor to that page would download a PDF engine to render a file
 * picker. Metadata here; machinery in parse.ts.
 */

export const UPLOAD_LIMITS = {
  /**
   * 15 MB. Comfortably larger than any business plan or annual report, and
   * small enough that a parse cannot occupy a request slot indefinitely.
   */
  maxBytes: 15 * 1024 * 1024,
  /**
   * Characters kept from one document. A 2-million-character upload is not a
   * business plan, and extraction over it would cost more than it returns.
   */
  maxCharacters: 400_000,
} as const;

export type DocumentKind = 'pdf' | 'docx' | 'text';

/** What we accept, keyed by the MIME type browsers actually send. */
const ACCEPTED: Record<string, DocumentKind> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'text',
  'text/markdown': 'text',
  'text/x-markdown': 'text',
};

const EXTENSIONS: Record<string, DocumentKind> = {
  pdf: 'pdf',
  docx: 'docx',
  txt: 'text',
  md: 'text',
  markdown: 'text',
};

export const ACCEPT_ATTRIBUTE = '.pdf,.docx,.txt,.md';

/**
 * Decide what a file is.
 *
 * The extension is consulted only when the browser sends nothing useful —
 * some send `application/octet-stream` for a .docx. The file's own bytes are
 * what the parser ultimately relies on, so a wrong guess fails at parse time
 * rather than producing nonsense.
 */
export function classify(filename: string, mimeType: string): DocumentKind | null {
  const byMime = ACCEPTED[mimeType.split(';')[0]?.trim().toLowerCase() ?? ''];
  if (byMime !== undefined) return byMime;

  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSIONS[extension] ?? null;
}
