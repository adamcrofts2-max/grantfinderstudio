'use client';

import { useState } from 'react';

/**
 * Copy plain text to the clipboard.
 *
 * Plain text only: funder portals mangle pasted formatting, and the
 * provenance highlighting in the draft must not travel with it.
 *
 * When an answer contains claims nothing supports, the button says so and asks
 * once before copying. The whole product exists so that nobody submits an
 * unverified claim; copying one out silently would undo that. It warns rather
 * than blocks — it is the applicant's decision, but it will not be an
 * accidental one.
 */
export function CopyButton({
  text,
  label = 'Copy answer',
  unsupportedCount = 0,
  variant = 'secondary',
}: {
  text: string;
  label?: string;
  unsupportedCount?: number;
  variant?: 'primary' | 'secondary';
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed' | 'confirming'>('idle');

  async function copy(): Promise<void> {
    if (unsupportedCount > 0 && state !== 'confirming') {
      setState('confirming');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
      setTimeout(() => setState('idle'), 2500);
    } catch {
      // Usually a browser refusing clipboard access outside a secure context.
      setState('failed');
    }
  }

  const warning = unsupportedCount > 0;

  return (
    <span className="copywrap">
      <button
        type="button"
        className={`btn btn-${variant}${warning ? ' btn-warn' : ''}`}
        onClick={() => void copy()}
      >
        {state === 'copied'
          ? 'Copied'
          : state === 'confirming'
            ? 'Copy anyway'
            : warning
              ? `${label} (${unsupportedCount} unsupported)`
              : label}
      </button>

      <span role="status" aria-live="polite" className="copystatus">
        {state === 'confirming' ? (
          <span className="notice notice-caution">
            <span aria-hidden="true">⚠</span>
            <span>
              {unsupportedCount === 1
                ? 'One sentence has nothing behind it.'
                : `${unsupportedCount} sentences have nothing behind them.`}{' '}
              An assessor will ask. Press again to copy regardless.
            </span>
          </span>
        ) : null}
        {state === 'copied' ? <span className="copied">Copied as plain text.</span> : null}
        {state === 'failed' ? (
          <span className="notice notice-caution">
            <span aria-hidden="true">⚠</span>
            <span>Your browser blocked the copy. Select the text and copy it by hand.</span>
          </span>
        ) : null}
      </span>
    </span>
  );
}
