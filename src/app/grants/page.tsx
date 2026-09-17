import { after } from 'next/server';

import { getDatabase } from '@/db';
import { requireSession } from '@/app/session';
import { loadOrganisation, loadProject } from '@/db/queries';
import { rankGrants } from '@/domain/grants/query';
import { filtersFromParams, filtersToParams, hasFilters } from '@/domain/grants/facets';
import { rankFunders } from '@/domain/grants/funders';
import { gbp } from '@/app/components';
import { nudgeCorpusOnVisit } from '@/app/corpus-autostart';
import { RECENT_WINDOW_LABEL } from '@/domain/grants/recency';

import { searchCorpus, type CorpusState, type FoundGrant } from './search';
import { GrantSearchForm } from './GrantSearchForm';
import { Narrow } from './Narrow';
import { FunderList } from './FunderList';
import { RecipientList } from './RecipientList';

export const dynamic = 'force-dynamic';

const str = (v: string | string[] | undefined): string => (typeof v === 'string' ? v : '');

const count = (n: number): string => n.toLocaleString('en-GB');

/**
 * What the corpus is, in a sentence a person can act on.
 *
 * Three versions of this message have been wrong, each less wrong than the
 * last, and the last one was still wrong in the way that matters:
 *
 *  1. "No grants have been loaded yet. An operator loads a funder's grants
 *     from the console." — named somebody else's job as the reason your search
 *     was empty.
 *  2. "…the record has to be assembled before it can be searched. That has not
 *     been started here." — true, and it read as "there is no way to search
 *     grants".
 *  3. "Searching will work as soon as it has… start it under Funders." — still
 *     waiting on an operator, just more politely. The point was never the
 *     wording. It was that an applicant was blocked on admin work.
 *
 * Nothing waits on a person now: arriving here starts the record and advances
 * it. So the message is about what is happening, in the present tense, and
 * there is no operator line at all — there is nothing for an operator to do
 * that this page has not already done.
 */
function CorpusNotice({ corpus }: { corpus: CorpusState }) {
  if (corpus.awards > 0 && !corpus.loading) return null;

  const held =
    corpus.awards === 0
      ? ''
      : ` ${count(corpus.awards)} grants from ${count(corpus.funders)} funders so far, and searching them works now.`;

  const through =
    corpus.fraction === null
      ? ''
      : ` About ${Math.round(corpus.fraction * 100)}% of the funders have been read.`;

  return (
    <div className="banner" style={{ marginTop: 'var(--s-4)' }} role="status">
      <span aria-hidden="true">⏳</span>
      <span>
        <strong>We are building the grant record now.</strong> 360Giving publish no search
        across all grants — their API answers for one named funder at a time — so we read
        every funder that publishes and keep their grants from {RECENT_WINDOW_LABEL} here.
        That started the moment you arrived and continues in the background.
        {held}
        {through} Come back in a few minutes and there will be more.
      </span>
    </div>
  );
}

function GrantRow({ grant }: { grant: FoundGrant }) {
  return (
    <li className="fact" key={grant.id}>
      <div className="fact-main">
        <div className="fact-body">
          <p className="fact-claim">
            {grant.awardedOn}
            {grant.funderName === null ? '' : ` · ${grant.funderName}`}
          </p>
          <p className="fact-value">
            {gbp(grant.amountGbp)}
            {grant.recipientName === null ? '' : ` to ${grant.recipientName}`}
          </p>
          {grant.title === null ? null : (
            <p className="fact-source" style={{ color: 'var(--ink)' }}>{grant.title}</p>
          )}
          {grant.description === null ? null : (
            <p className="fact-source">{grant.description}</p>
          )}
          <p className="fact-source">{[grant.region, ...grant.tags].filter(Boolean).join(' · ')}</p>
        </div>
        {grant.funderId === null ? null : (
          <div className="fact-do">
            <a
              className="link-quiet"
              href={`/opportunities/add?funder=${encodeURIComponent(grant.funderId)}&funderName=${encodeURIComponent(grant.funderName ?? '')}`}
            >
              {/* Short on purpose: the funder's name is already the first line
                  of the row, and carrying it here ran the link past the right
                  edge at 390px. The full name stays for a screen reader, where
                  the link may be read out of context. */}
              Add a fund from them
              {grant.funderName === null ? null : (
                <span className="sr-only"> — {grant.funderName}</span>
              )}
            </a>
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Grants already awarded, searched across every funder we hold.
 *
 * The applicant's own question — "who like us has been given money, how much,
 * and by whom". Nothing here is an open call. Every row is money already paid
 * out, which is why it is worth reading: behaviour is a better guide than a
 * priorities page.
 */
export default async function GrantsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /**
   * A SESSION, not an organisation.
   *
   * `requireOrganisationId` sent a brand-new account to onboarding, so the one
   * screen that needs nothing but public data was the one screen you had to
   * finish setting up to reach. Nothing here is tenant-scoped: the grants are
   * published open data, and an organisation only sharpens the ranking.
   */
  const session = await requireSession();
  const params = await searchParams;



  const context =
    session.organisationId === null
      ? { organisation: null, project: null }
      : await (await getDatabase()).withTenant(session.organisationId, async (tx) => ({
          organisation: await loadOrganisation(tx),
          project: await loadProject(tx),
        }));

  const region = context.organisation?.profile.region ?? null;
  const groups = context.project?.beneficiaryGroups ?? [];
  const ask = context.project?.amountSoughtGbp ?? null;

  // A first visit searches for what they do, so the screen is useful before
  // anybody types. Once the form has been used, `q` is present and their words
  // win — including an empty box, which means "I am starting again".
  const asked = 'q' in params;
  const suggested = [...groups, region].filter((part): part is string => Boolean(part)).join(' ');
  const text = asked ? str(params['text']) : suggested;

  const filters = filtersFromParams(params);
  const result = await searchCorpus(text, filters, { region, amountSoughtGbp: ask });

  /**
   * Funders or grants.
   *
   * Funders by default, because "who would fund us" is the question and a
   * list of grants makes the reader group them in their head. The grant list
   * is one tap away and unchanged — the choice is in the URL like everything
   * else on this page, so it survives the back button and can be shared.
   */
  const view =
    str(params['view']) === 'grants'
      ? 'grants'
      : str(params['view']) === 'peers'
        ? 'peers'
        : 'funders';
  const viewHref = (next: 'funders' | 'grants' | 'peers'): string =>
    `/grants?${new URLSearchParams({
      q: '1',
      text,
      ...filtersToParams(filters),
      ...(next === 'funders' ? {} : { view: next }),
    }).toString()}`;

  const recipients = result.state === 'ok' ? result.recipients : [];

  const funders =
    result.state === 'ok'
      ? rankFunders(result.funders, {
          region,
          amountSoughtGbp: ask,
          asOf: new Date().toISOString().slice(0, 10),
        })
      : [];

  /**
   * Arriving here is what fills the record.
   *
   * `after()` so it cannot delay this response, and a database lease inside so
   * a hundred visitors in a minute produce one step rather than a hundred. The
   * scheduled job is a backstop for a quiet week, not the engine.
   */
  if (result.state !== 'failed' && (result.corpus.loading || result.corpus.awards === 0)) {
    after(async () => {
      await nudgeCorpusOnVisit();
    });
  }
  /**
   * Words typed that appear in no grant we hold.
   *
   * From `facets.terms`, which counts each word over the whole corpus rather
   * than over the result — so this separates "the record has none of these"
   * from "your filters removed them", which are different problems and looked
   * identical.
   */
  const unmatched =
    result.state === 'ok' ? result.facets.terms.filter((t) => t.matches === 0).map((t) => t.term) : [];
  /** How many words were searchable at all, so the empty state can tell the
   *  difference between "none of your words are here" and "some are". */
  const queryWords = result.state === 'ok' ? result.facets.terms.length : 0;

  const ranked =
    result.state === 'ok'
      ? rankGrants(result.grants, { region, amountSoughtGbp: ask })
      : [];

  /**
   * Distinct LICENCES, not attributions.
   *
   * The first version listed `attribution`, which is one line per publisher —
   * so the footer read "Stub Trust 1, published to the 360Giving Data
   * Standard; Stub Trust 2, published to the 360Giving Data Standard; …" and
   * grew with the result set. The licence is the part a reader has to act on,
   * and there are only a handful of them.
   */
  const licences =
    result.state === 'ok'
      ? [...new Set(ranked.map((g) => g.licence).filter((l): l is string => l !== null))].toSorted()
      : [];

  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">Grants already awarded</p>
        <h1 className="page-title" style={{ marginTop: 'var(--s-2)' }}>
          Who like you has been funded
        </h1>
        <p className="page-sub">
          Every grant published to the 360Giving standard that we hold — money that has
          already been paid out. So it is not a list of what is open. It is the best evidence
          there is of who gives to work like yours, and how much.
        </p>
        {/* Two screens answer a version of "who would fund us", and a person
            who found one had no way of knowing the other existed. This one is
            driven by WHAT YOU TYPE; /funders is driven by your own profile and
            weighs each funder against your ask. Each now says so and points at
            the other. */}
        <p className="page-sub" style={{ marginTop: 'var(--s-3)' }}>
          Searching here is for a question you have in mind. If you would rather we worked it
          out from your own details — and weighed each funder against what you are asking for
          — <a href="/funders">see who funds work like yours</a>.
        </p>
      </header>

      <GrantSearchForm text={text} suggested={suggested} derived={!asked && text !== ''} />

      {result.state === 'ok' ? (
        <Narrow
          amountSoughtGbp={ask}
          /**
           * `view` travels with every filter link.
           *
           * Without it, tapping a chip while reading "Every grant" bounced you
           * back to the funder view — the filter applied and the page you were
           * on vanished. The chips rebuild the filter half of the URL from
           * scratch, so anything else that must survive has to be in `base`.
           */
          base={{ q: '1', text, ...(view === 'grants' ? { view: 'grants' } : {}) }}
          facets={result.facets}
          filters={filters}
        />
      ) : null}

      {result.state === 'failed' ? null : <CorpusNotice corpus={result.corpus} />}

      {result.state === 'failed' ? (
        <section className="card" style={{ marginTop: 'var(--s-5)' }}>
          <h2 className="card-title">The search could not run</h2>
          <p className="notice notice-caution" role="alert" style={{ marginTop: 'var(--s-3)' }}>
            <span aria-hidden="true">⚠</span>
            <span>{result.message}</span>
          </p>
        </section>
      ) : result.state === 'idle' ? (
        <>
          <section className="card" style={{ marginTop: 'var(--s-5)' }}>
            <h2 className="card-title">What sort of work?</h2>
            <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
              Type what you do and where you are — <em>youth skills Somerset</em>,{' '}
              <em>food bank Leeds</em>, <em>chapel roof</em>. Short, ordinary words work best:
              these are grants as their funders described them, not a catalogue with
              categories. Half a word is enough — <em>somer</em> finds Somerset.
            </p>
            <p className="hint" style={{ marginTop: 'var(--s-3)' }}>
              What is held is every UK funder who publishes to 360Giving, for{' '}
              {RECENT_WINDOW_LABEL}. Older grants are not here — a funder who last gave in
              2019 has usually either closed the programme or changed it.
            </p>
          </section>

          {result.recent.length === 0 ? null : (
            <>
              <p className="hint" style={{ marginTop: 'var(--s-5)' }}>
                The most recent {result.recent.length} of {count(result.corpus.awards)} grants
                held, while you decide what to ask.
              </p>
              <ul className="facts" style={{ marginTop: 'var(--s-3)' }}>
                {result.recent.map((grant) => (
                  <GrantRow grant={grant} key={grant.id} />
                ))}
              </ul>
            </>
          )}
        </>
      ) : ranked.length === 0 ? (
        <section className="card" style={{ marginTop: 'var(--s-5)' }}>
          <h2 className="card-title">Nothing came back for that</h2>
          <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
            {result.corpus.awards === 0
              ? 'There are no grants here to search yet — the record is still being built, as above.'
              : hasFilters(filters)
                ? 'Your words match grants, but not once the filters above are applied. Remove one and the counts will show you what is there.'
                : unmatched.length > 0
                  ? `No grant among the ${count(result.corpus.awards)} held mentions ${unmatched.join(' or ')}${unmatched.length === queryWords ? '' : ', and the rest of your words matched nothing close enough to count'}. Try plainer ones — funders write "young people" more often than "youth engagement". Only ${RECENT_WINDOW_LABEL} are held, so an older programme will not be here.`
                  : `No grant among the ${count(result.corpus.awards)} held is a close enough match for those words. Try fewer of them, or plainer ones — funders write "young people" more often than "youth engagement". Only ${RECENT_WINDOW_LABEL} are held, so an older programme will not be here.`}
          </p>
        </section>
      ) : (
        <>
          {/* THE WORDS THAT FOUND NOTHING.
              The most useful thing a search can tell you and the one thing it
              never did. Somebody searched "community tree nursery somerset"
              against a record holding no nurseries, got 47% of everything
              back, and had no way to see that their most specific word was
              the one doing nothing — so the breadth read as a broken search
              rather than as a gap in the record. Counted over the whole
              corpus, so this says "we hold none of these" and not "your
              filters removed them". */}
          {unmatched.length === 0 ? null : (
            <p className="notice notice-caution" style={{ marginTop: 'var(--s-5)' }}>
              <span aria-hidden="true">⚠</span>
              <span>
                No grant we hold mentions{' '}
                {unmatched.map((word, i) => (
                  <span key={word}>
                    {i === 0 ? '' : i === unmatched.length - 1 ? ' or ' : ', '}
                    <strong>{word}</strong>
                  </span>
                ))}
                . {unmatched.length === 1 ? 'That word is' : 'Those words are'} doing nothing
                here, so what follows matches the rest of your search. Funders write plainly —
                “growing” finds more than “horticulture”.
              </span>
            </p>
          )}
          <p className="hint" style={{ marginTop: 'var(--s-5)' }}>
            {view === 'peers'
              ? `${count(recipients.length)} organisation${recipients.length === 1 ? '' : 's'} received ${count(result.facets.total)} grant${result.facets.total === 1 ? '' : 's'} close to your search. Closest to your size first.`
              : view === 'funders'
              ? // "grants like yours" oversold the number, and then "grants
                // mentioning your words" undersold what the search now does.
                // A search is ANY of your words — deliberately, so that "youth
                // skills Somerset" still finds a grant described as "young
                // people, employment training" — and that made the total
                // breadth rather than fit: 61% of everything held, on a
                // measured corpus. The relevance floor is what changed it. The
                // count is now the grants close enough to the best match for
                // the same words to be worth a number, which on that corpus
                // was 49 rather than 284, so "close to your search" is a claim
                // the query can keep.
                `${count(funders.length)} funder${funders.length === 1 ? '' : 's'} between them gave ${count(result.facets.total)} grant${result.facets.total === 1 ? '' : 's'} close to your search. The closest fit first.`
              : result.facets.total > ranked.length
                ? `Showing ${count(ranked.length)} of ${count(result.facets.total)} grants close to your search, the closest to your work first.`
                : `${count(ranked.length)} grant${ranked.length === 1 ? '' : 's'} close to your search, the closest to your work first.`}
            {hasFilters(filters) ? ' Narrowed by your filters above.' : ''}
            {/* Said on the results themselves, not only on the empty state. A
                funder who last gave in 2019 is simply absent here, and there
                is nothing on a list of results to tell you that a silence
                means "outside the window" rather than "never funded this". */}
            {` From ${RECENT_WINDOW_LABEL} of published grants.`}
          </p>

          <div className="views" role="tablist" aria-label="How to group these results">
            <a
              aria-selected={view === 'funders'}
              className={view === 'funders' ? 'view view-on' : 'view'}
              href={viewHref('funders')}
              rel="nofollow"
              role="tab"
            >
              By funder{funders.length === 0 ? '' : ` (${count(funders.length)})`}
            </a>
            {/* WHO GOT THEM.
                Asked for: "search via similar CICs and see the past grants
                they've been awarded." A peer's funder list is a plan in a way
                a funder's grant list is not. Third rather than first, because
                it only makes sense once a search describes your own work. */}
            <a
              aria-selected={view === 'peers'}
              className={view === 'peers' ? 'view view-on' : 'view'}
              href={viewHref('peers')}
              rel="nofollow"
              role="tab"
            >
              Who got them{recipients.length === 0 ? '' : ` (${count(recipients.length)})`}
            </a>
            <a
              aria-selected={view === 'grants'}
              className={view === 'grants' ? 'view view-on' : 'view'}
              href={viewHref('grants')}
              rel="nofollow"
              role="tab"
            >
              Every grant
            </a>
          </div>

          {view === 'peers' ? (
            <RecipientList recipients={recipients} region={region} />
          ) : view === 'funders' ? (
            <FunderList
              context={{
                region,
                amountSoughtGbp: ask,
                asOf: new Date().toISOString().slice(0, 10),
              }}
              funders={funders}
            />
          ) : (
            <ul className="facts" style={{ marginTop: 'var(--s-3)' }}>
              {ranked.map((grant) => (
                <GrantRow grant={grant} key={grant.id} />
              ))}
            </ul>
          )}
        </>
      )}

      <p className="ingest-licence" style={{ marginTop: 'var(--s-6)' }}>
        Grant data published to the 360Giving Data Standard. Each funder publishes under their
        own open licence — check it before republishing a row, since some are share-alike.
        {licences.length === 0
          ? ''
          : ` On this page: ${licences.slice(0, 4).join(', ')}${licences.length > 4 ? ' and others' : ''}.`}
      </p>
    </div>
  );
}
