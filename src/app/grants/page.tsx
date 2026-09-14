import { getDatabase } from '@/db';
import { requireSession } from '@/app/session';
import { loadOrganisation, loadProject } from '@/db/queries';
import { queryTerms, rankGrants } from '@/domain/grants/query';
import { gbp } from '@/app/components';

import { searchCorpus, type CorpusState, type FoundGrant } from './search';
import { GrantSearchForm } from './GrantSearchForm';

export const dynamic = 'force-dynamic';

const str = (v: string | string[] | undefined): string => (typeof v === 'string' ? v : '');

const count = (n: number): string => n.toLocaleString('en-GB');

/**
 * What the corpus is, in a sentence a person can act on.
 *
 * The screen this replaced said "no grants have been loaded yet. An operator
 * loads a funder's grants from the console." That was accurate and it was the
 * product telling on itself — it named somebody else's job as the reason your
 * search was empty. An empty corpus is now either arriving or not started, and
 * both of those are facts about the system rather than instructions to the
 * reader.
 */
function CorpusNotice({ corpus }: { corpus: CorpusState }) {
  if (corpus.awards > 0 && !corpus.loading) return null;

  if (corpus.loading) {
    const through =
      corpus.fraction === null
        ? `${count(corpus.progress.fundersDone)} funders so far`
        : `${Math.round(corpus.fraction * 100)}% through`;
    return (
      <div className="banner" style={{ marginTop: 'var(--s-4)' }} role="status">
        <span aria-hidden="true">⏳</span>
        <span>
          <strong>The grant record is still arriving.</strong> We are reading every funder
          that publishes to the 360Giving standard and keeping their awarded grants here so
          this search is instant — {through}, {count(corpus.awards)} grants from{' '}
          {count(corpus.funders)} funders held so far. Search works now; it will find more
          each time you come back.
        </span>
      </div>
    );
  }

  return (
    <div className="banner" style={{ marginTop: 'var(--s-4)' }} role="status">
      <span aria-hidden="true">⚠</span>
      <span>
        <strong>This deployment holds no grant record yet.</strong> 360Giving publish no
        search across all grants — their API answers for one named funder at a time — so the
        record has to be assembled before it can be searched. That has not been started here.
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

  const result = await searchCorpus(text);
  const terms = queryTerms(text);
  const ranked =
    result.state === 'ok'
      ? rankGrants(result.grants, { terms, region, amountSoughtGbp: ask })
      : [];

  const licences =
    result.state === 'ok'
      ? [...new Set(ranked.map((g) => g.attribution).filter((a): a is string => a !== null))]
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
      </header>

      <GrantSearchForm text={text} suggested={suggested} derived={!asked && text !== ''} />

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
              categories.
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
              ? 'There are no grants here to search yet — see above.'
              : `No grant among the ${count(result.corpus.awards)} held mentions any of those words. Try fewer of them, or plainer ones — funders write "young people" more often than "youth engagement".`}
          </p>
        </section>
      ) : (
        <>
          <p className="hint" style={{ marginTop: 'var(--s-5)' }}>
            {count(ranked.length)}
            {result.capped ? '+' : ''} of {count(result.corpus.awards)} grants held, the
            closest to your work first.
          </p>

          <ul className="facts" style={{ marginTop: 'var(--s-3)' }}>
            {ranked.map((grant) => (
              <GrantRow grant={grant} key={grant.id} />
            ))}
          </ul>
        </>
      )}

      <p className="ingest-licence" style={{ marginTop: 'var(--s-6)' }}>
        Grant data published to the 360Giving Data Standard. Each funder publishes under their
        own open licence — check it before republishing a row, since some are share-alike.
        {licences.length === 0
          ? ''
          : ` Shown here: ${licences.slice(0, 4).join('; ')}${licences.length > 4 ? ' and others' : ''}.`}
      </p>
    </div>
  );
}
