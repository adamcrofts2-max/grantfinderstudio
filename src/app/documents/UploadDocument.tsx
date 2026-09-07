'use client';

import { useActionState, useRef, useState } from 'react';

// From accepted.ts, not parse.ts: importing the parser here would ship a
// PDF engine to every browser that opens this page.
import { ACCEPT_ATTRIBUTE, UPLOAD_LIMITS } from '@/documents/accepted';
import { uploadDocumentAction } from './actions';
import { ACCEPTED_DESCRIPTION, formatBytes, IDLE } from './state';

/**
 * Upload a document for reading.
 *
 * The copy does the work here. People are, rightly, careful about handing an
 * AI their organisation's private papers, so the screen says plainly what
 * happens to the file: the text is kept, the file is not, and nothing it
 * finds becomes true until they say so.
 */
export function UploadDocument() {
  const [state, upload, uploading] = useActionState(uploadDocumentAction, IDLE);
  const [chosen, setChosen] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const tooBig = chosen !== null && chosen.size > UPLOAD_LIMITS.maxBytes;

  return (
    <form
      className="card"
      action={(formData) => {
        upload(formData);
        setChosen(null);
        if (input.current !== null) input.current.value = '';
      }}
    >
      <h2 className="card-title">Add a document</h2>
      <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
        Your business plan, last annual report, or a funding application you have already
        written. We read the text, suggest what it says about you, and you decide what is true.
      </p>

      <div className="field" style={{ marginTop: 'var(--s-4)' }}>
        <label className="label" htmlFor="file">
          Choose a file
        </label>
        <input
          ref={input}
          id="file"
          className="input"
          type="file"
          name="file"
          accept={ACCEPT_ATTRIBUTE}
          onChange={(event) => setChosen(event.target.files?.[0] ?? null)}
        />
        <p className="hint" id="file-hint">
          {ACCEPTED_DESCRIPTION}, up to {UPLOAD_LIMITS.maxBytes / (1024 * 1024)} MB.
          {chosen === null ? null : ` Selected: ${chosen.name} (${formatBytes(chosen.size)}).`}
        </p>
      </div>

      {tooBig ? (
        <p className="notice notice-caution">
          <span aria-hidden="true">⚠</span>
          <span>
            That file is {formatBytes(chosen.size)}, over the{' '}
            {UPLOAD_LIMITS.maxBytes / (1024 * 1024)} MB limit.
          </span>
        </p>
      ) : null}

      <button
        className="btn btn-primary"
        type="submit"
        disabled={uploading || chosen === null || tooBig}
        style={{ marginTop: 'var(--s-4)' }}
      >
        {uploading ? 'Reading the document…' : 'Read this document'}
      </button>

      {uploading ? (
        <p className="hint" style={{ marginTop: 'var(--s-3)' }}>
          A long document can take a minute. Nothing is saved until it has been read.
        </p>
      ) : null}

      {state.ok === false ? (
        <p className="notice notice-caution" style={{ marginTop: 'var(--s-4)' }} role="alert">
          <span aria-hidden="true">⚠</span>
          <span>{state.message}</span>
        </p>
      ) : null}

      {state.ok === true ? (
        <div className="notice notice-neutral" style={{ marginTop: 'var(--s-4)' }} role="status">
          <span>
            {state.message}{' '}
            {(state.added ?? 0) === 0 && (state.conflicts ?? 0) === 0
              ? 'Nothing new to add — everything it says, you had already recorded.'
              : `${state.added ?? 0} new ${(state.added ?? 0) === 1 ? 'suggestion' : 'suggestions'} to check` +
                ((state.conflicts ?? 0) > 0
                  ? `, and ${state.conflicts} that ${(state.conflicts ?? 0) === 1 ? 'disagrees' : 'disagree'} with something you already have on file.`
                  : '.')}
          </span>
        </div>
      ) : null}

      <p className="hint" style={{ marginTop: 'var(--s-4)' }}>
        We keep the text we read, not the file itself. Nothing found in a document is used in an
        application until you have confirmed it.
      </p>
    </form>
  );
}
