import { getDatabase } from '@/db';
import { requireSession } from '@/app/session';
import { loadOrganisation, loadProject } from '@/db/queries';
import { queryTerms, rankGrants } from '@/domain/grants/query';
import { gbp } from '@/app/components';

import { searchCorpus } from './search';
import { GrantSearchForm } from './GrantSearchForm';

export const dynamic = 'force-dynamic';

const str = (v: string | string[] | undefined): string => (typeof v === 'string' ? v : '');

/**
 * Search every grant 360Giving holds.
 *
 * The applicant's own question — "who like us has been given money, how much,
 * and by whom" — asked of the whole corpus rather than of whatever an operator
 * had loaded. The previous version searched a local table filled in one funder
 * at a time, so somebody who came here to look was told "no grants have been
 * loaded yet": the honest report of a design that had put an administrator
 * between a person and public data.
 *
 * Nothing here is an open call. Every row is money already paid out, which is
 * why it is worth reading — behaviour is a better guide than a priorities page.
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
   * finish setting up to reach. Nothing here is tenant-scoped: the grants come
   * from 360Giving, and an organisation only sharpens the ranking. Somebody
   * should be able to see whether this tool is worth their evening before
   * telling it who they are.
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

  const found = await searchCorpus(text);
  const terms = queryTerms(text);
  const ranked =
    found.state === 'ok'
      ? rankGrants(found.grants, { terms, region, amountSoughtGbp: ask })
      : [];

  const publishers = [
    ...new Set(ranked.map((g) => g.publisherName).filter((n): n is string => n !== null)),
  ];

  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">Grants already awarded</p>
        <h1 className="page-title" style={{ marginTop: 'var(--s-2)' }}>
          Who like you has been funded
        </h1>
        <p className="page-sub">
          Searched across every grant published to the 360Giving standard — over a million of
          them, from more than two hundred funders. Each row is money that has already been
          paid out, so it is not a list of what is open. It is the best evidence there is of
          who gives to work like yours, and how much.
        </p>
      </header>

      <GrantSearchForm text={text} suggested={suggested} derived={!asked && text !== ''} />

      {found.state === 'failed' ? (
        <section className="card" style={{ marginTop: 'var(--s-5)' }}>
          <h2 className="card-title">The search could not run</h2>
          <p className="notice notice-caution" role="alert" style={{ marginTop: 'var(--s-3)' }}>
            <span aria-hidden="true">⚠</span>
            <span>{found.message}</span>
          </p>
        </section>
      ) : found.state === 'idle' ? (
        <section className="card" style={{ marginTop: 'var(--s-5)' }}>
          <h2 className="card-title">What sort of work?</h2>
          <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
            Type what you do and where you are — <em>youth skills Somerset</em>,{' '}
            <em>food bank Leeds</em>, <em>chapel roof</em>. Short, ordinary words work best:
            these are grants as their funders described them, not a catalogue with categories.
          </p>
        </section>
      ) : ranked.length === 0 ? (
        <section className="card" style={{ marginTop: 'var(--s-5)' }}>
          <h2 className="card-title">Nothing came back for that</h2>
          <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
            {found.total === 0
              ? 'No published grant mentions those words. Try fewer of them, or plainer ones — funders write "young people" more often than "youth engagement".'
              : 'The grants that came back could not be read — a missing date or a currency other than sterling, which we decline rather than guess at.'}
          </p>
        </section>
      ) : (
        <>
          <p className="hint" style={{ marginTop: 'var(--s-5)' }}>
            {found.total === null
              ? `${ranked.length} grants.`
              : `${ranked.length} of ${found.total.toLocaleString('en-GB')} matching grants, the closest to your work first.`}
          </p>

          <ul className="facts" style={{ marginTop: 'var(--s-3)' }}>
            {ranked.map((grant) => (
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
                    <p className="fact-source">
                      {[grant.region, ...grant.tags].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {grant.funderId === null ? null : (
                    <div className="fact-do">
                      <a
                        className="link-quiet"
                        href={`/opportunities/add?funder360=${encodeURIComponent(grant.funderId)}&funderName=${encodeURIComponent(grant.funderName ?? '')}`}
                      >
                        {/* Short on purpose: the funder's name is already the
                            first line of the row, and carrying it here ran the
                            link past the right edge at 390px. The full name
                            stays for a screen reader, where the link may be
                            read out of context. */}
                        Add a fund from them
                        {grant.funderName === null ? null : (
                          <span className="sr-only"> — {grant.funderName}</span>
                        )}
                      </a>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="ingest-licence" style={{ marginTop: 'var(--s-6)' }}>
        Grant data from the 360Giving Data Store, searched live and not stored here.
        {publishers.length === 0
          ? ''
          : ` Published by ${publishers.slice(0, 6).join(', ')}${publishers.length > 6 ? ' and others' : ''}`}
        , each under their own open licence.
      </p>
    </div>
  );
}
