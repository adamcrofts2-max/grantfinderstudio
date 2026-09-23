import type { SentenceLabel } from '@/domain/provenance/sentence-label';

export interface TracedSentence {
  text: string;
  label: SentenceLabel;
}

/**
 * A draft, sentence by sentence, with what each one stands on underneath it.
 *
 * Drawn the way the landing page draws its illustration, on purpose: that
 * picture is the promise, and this is where it is kept. It used to be the
 * same prose run together with the provenance in hover tooltips — invisible
 * on a phone, undiscoverable on a laptop, and read by nobody.
 *
 * No hooks and no server-only imports, so the applicant's workspace (a client
 * component) and the reviewer's page (a server one) render the same thing.
 */
export function DraftTrace({
  sentences,
  heading,
  note,
}: {
  sentences: readonly TracedSentence[];
  heading: string;
  note?: string | null;
}) {
  if (sentences.length === 0) return null;
  return (
    <section className="trace" aria-label={heading}>
      <h3 className="trace-heading">{heading}</h3>
      {note ? <p className="hint trace-note">{note}</p> : null}
      <ol className="trace-list">
        {sentences.map((sentence, index) => (
          // Index as key: the same sentence can appear twice in one answer,
          // and the order IS the identity here.
          <li className={`trace-sentence trace-${sentence.label.tone}`} key={index}>
            <span className="trace-text">{sentence.text}</span>
            <span className="trace-cite">
              {sentence.label.tone === 'unsupported' ? (
                <span aria-hidden="true">⚠ </span>
              ) : null}
              {sentence.label.text}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
