/**
 * Reading an organisation's own website to propose facts about it.
 *
 * The same pipeline as a document, with one step swapped: a fetched page in
 * place of a parsed file. Everything after that is deliberately shared —
 * the same Extractor, the same fenced untrusted block, the same
 * reconciliation against what is already held, and the same rule that nothing
 * extracted is ever confirmed. A second path with its own idea of provenance
 * is how a product ends up with facts nobody checked.
 *
 * Nothing is written here. The caller decides what to persist, in its own
 * transaction, so a failed read leaves nothing behind.
 *
 * ## What makes this safe to point at the open web
 *
 * The page is somebody else's text arriving at a model, and there are three
 * separate reasons that is survivable:
 *
 *  - `fetchPage` decides WHETHER to read it at all — https, a public
 *    hostname, a public resolved address, and every redirect re-checked.
 *  - `htmlToText` strips script, style and comment CONTENT before tags, so
 *    the most obvious place to hide instructions never reaches the prompt.
 *  - The Extractor fences the text as untrusted and reports anything that
 *    addressed the model rather than describing the organisation, and every
 *    fact it proposes is UNCONFIRMED until a person says otherwise.
 *
 * The last one is the one that actually matters. A page that talks the model
 * into proposing "annual turnover: £2m" gets a person looking at a row that
 * says £2m with a quote from the page beside it, and saying no.
 */

import { reconcile, summarise } from '../../domain/provenance/reconcile.js';
import type {
  CandidateClaim,
  Reconciliation,
  ReconciliationSummary,
} from '../../domain/provenance/reconcile.js';
import type { Fact } from '../../domain/provenance/facts.js';
import type { ExtractFn } from '../../documents/ingest.js';

import { fetchPage, WebFetchError } from './fetch.js';
import { hasEnoughText, htmlToText } from './text.js';

export interface WebIngestInput {
  url: string;
  /** Facts the organisation already holds, for reconciliation. */
  existingFacts: readonly Fact[];
}

export interface WebIngestResult {
  /** The address actually read, after redirects. */
  url: string;
  /** How much prose the page gave us, for the record. */
  characters: number;
  results: Reconciliation[];
  summary: ReconciliationSummary;
  /** Text on the page that addressed the model rather than describing the CIC. */
  instructionLikeContent: string[];
}

export async function ingestWebsite(
  input: WebIngestInput,
  extract: ExtractFn,
): Promise<WebIngestResult> {
  const page = await fetchPage(input.url);
  const text = htmlToText(page.html);

  if (!hasEnoughText(text)) {
    // A page of navigation and a cookie banner is not a description of an
    // organisation. Spending a model call on it produces confident nonsense,
    // and the person is better told to give us a page with words on it.
    throw new WebFetchError(
      'There was not much text on that page. Try the page that describes what you do — an “About us” page usually works better than a home page.',
    );
  }

  // One call: a website page is a page, not a document of eighty. The label is
  // the address, so a fact's provenance names where it came from in terms the
  // person recognises.
  const output = await extract(text, page.url);

  const candidates: CandidateClaim[] = [...output.facts];
  const results = reconcile(candidates, input.existingFacts);

  return {
    url: page.url,
    characters: text.length,
    results,
    summary: summarise(results),
    instructionLikeContent: [...new Set(output.instructionLikeContent)],
  };
}
