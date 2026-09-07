import { getDatabase } from '@/db';
import { loadDocuments } from '@/db/documents';
import { DEMO_ORG_ID } from '@/demo/seed';
import { isWriterAvailable } from '@/app/drafting';

import { deleteDocumentAction } from './actions';
import { formatBytes } from './state';
import { UploadDocument } from './UploadDocument';

export const dynamic = 'force-dynamic';

const STATE_BADGE = {
  pending: { label: 'Not read yet', className: 'badge badge-neutral', mark: '·' },
  extracted: { label: 'Read', className: 'badge badge-positive', mark: '✓' },
  failed: { label: 'Could not read', className: 'badge badge-negative', mark: '✕' },
} as const;

function describe(pageCount: number | null, characterCount: number | null): string {
  const pages =
    pageCount === null ? null : `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`;
  const words =
    characterCount === null
      ? null
      : `about ${Math.round(characterCount / 6).toLocaleString('en-GB')} words`;
  return [pages, words].filter((part) => part !== null).join(' · ');
}

export default async function DocumentsPage() {
  const database = await getDatabase();
  const documents = await database.withTenant(DEMO_ORG_ID, (tx) => loadDocuments(tx));
  const writerAvailable = await isWriterAvailable();

  const pending = documents.reduce((total, doc) => total + doc.pendingFacts, 0);

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <p className="eyebrow">Documents</p>
        <h1 className="page-title" style={{ marginTop: 'var(--s-2)' }}>
          What you have already written
        </h1>
        <p className="page-sub">
          Most of what a funder asks, you have written down somewhere before. Add those documents
          here and we will suggest what they say about you — you confirm each one, and only then
          can it appear in an application.
        </p>
      </header>

      {writerAvailable ? null : (
        <p className="notice notice-caution">
          <span aria-hidden="true">⚠</span>
          <span>
            Reading documents needs an Anthropic key. Add one in <a href="/settings">Settings</a>{' '}
            first.
          </span>
        </p>
      )}

      <UploadDocument />

      {pending > 0 ? (
        <p className="notice notice-neutral" style={{ marginTop: 'var(--s-5)' }}>
          <span>
            {pending} {pending === 1 ? 'suggestion is' : 'suggestions are'} waiting for you to
            confirm or correct. <a href="/organisation">Go through them</a> — until you do, none
            of it can be used.
          </span>
        </p>
      ) : null}

      {documents.length === 0 ? null : (
        <section style={{ marginTop: 'var(--s-6)' }}>
          <h2 className="card-title">Documents you have added</h2>
          <div className="stack" style={{ marginTop: 'var(--s-4)' }}>
            {documents.map((doc) => {
              const badge = STATE_BADGE[doc.extractionState];
              return (
                <section className="card" key={doc.id}>
                  <div className="row-between">
                    <div style={{ flex: '1 1 18rem', minWidth: 0 }}>
                      <h3 className="opportunity-title">{doc.filename}</h3>
                      <p className="criteria-why">
                        {describe(doc.pageCount, doc.characterCount)} ·{' '}
                        {formatBytes(doc.byteSize)}
                      </p>

                      {doc.extractionState === 'failed' ? (
                        <p className="headline">{doc.extractionNote}</p>
                      ) : (
                        <p className="headline">
                          {doc.pendingFacts === 0 && doc.confirmedFacts === 0
                            ? 'Nothing new — everything it says, you had already recorded.'
                            : [
                                doc.confirmedFacts > 0
                                  ? `${doc.confirmedFacts} confirmed`
                                  : null,
                                doc.pendingFacts > 0
                                  ? `${doc.pendingFacts} still to check`
                                  : null,
                              ]
                                .filter((part) => part !== null)
                                .join(' · ')}
                        </p>
                      )}

                      {doc.truncated ? (
                        <p className="notice notice-caution" style={{ marginTop: 'var(--s-2)' }}>
                          <span aria-hidden="true">⚠</span>
                          <span>
                            This document was longer than we read. Everything after the first
                            part was not looked at.
                          </span>
                        </p>
                      ) : null}

                      {doc.instructionLikeContent.length > 0 ? (
                        <details className="card" style={{ marginTop: 'var(--s-3)' }}>
                          <summary>
                            <strong>
                              {doc.instructionLikeContent.length}{' '}
                              {doc.instructionLikeContent.length === 1
                                ? 'passage'
                                : 'passages'}{' '}
                              in this document tried to give the AI instructions
                            </strong>
                          </summary>
                          <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
                            The instructions were not followed — the text was treated as
                            content, not as a command. We are showing you because it is unusual
                            in a genuine business document, and worth knowing about.
                          </p>
                          <ul className="list" style={{ marginTop: 'var(--s-3)' }}>
                            {doc.instructionLikeContent.map((text) => (
                              <li key={text}>
                                <q>{text}</q>
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </div>

                    <div className="metric">
                      <span className={badge.className}>
                        <span aria-hidden="true">{badge.mark}</span>
                        {badge.label}
                      </span>
                      <form action={deleteDocumentAction} style={{ marginTop: 'var(--s-3)' }}>
                        <input type="hidden" name="documentId" value={doc.id} />
                        <button className="btn btn-secondary" type="submit">
                          Remove
                        </button>
                      </form>
                    </div>
                  </div>

                  {doc.confirmedFacts > 0 ? (
                    <p className="hint" style={{ marginTop: 'var(--s-3)' }}>
                      Removing this document keeps the {doc.confirmedFacts} fact
                      {doc.confirmedFacts === 1 ? '' : 's'} you have confirmed — those are yours
                      now, not the file’s.
                    </p>
                  ) : null}
                </section>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
