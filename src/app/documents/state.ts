/**
 * Shared types and constants for the documents screens.
 *
 * Separate from actions.ts because a 'use server' module may export only
 * async functions. Exporting a constant from one fails at runtime with the
 * value silently arriving as undefined — a mistake this codebase has made
 * three times, so it now has a home that cannot make it.
 */

export interface UploadState {
  ok: boolean | null;
  message: string;
  /** Set on success, so the interface can say what actually happened. */
  added?: number;
  conflicts?: number;
  alreadyKnown?: number;
  injected?: number;
}

export const IDLE: UploadState = { ok: null, message: '' };

/** What the upload control accepts, and what the hint text promises. */
export const ACCEPTED_DESCRIPTION = 'PDF, Word (.docx), plain text or Markdown';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
