import { getDatabase } from '@/db';
import { requireOrganisationId } from '@/app/session';
import { awardRegions, awardTags, countAwards, searchAwards } from '@/db/grants';
import { loadOrganisation, loadProject } from '@/db/queries';
import {
  criteriaLikeMine,
  isNarrowed,
  whySimilar,
  type GrantSearchCriteria,
} from '@/domain/grants/search';
import { gbp } from '@/app/components';
import { EmptyState } from '@/app/illustration/EmptyState';

import { GrantFilters } from './GrantFilters';

export const dynamic = 'force-dynamic';

const str = (v: string | string[] | undefined): string =>
  typeof v === 'string' ? v : '';

const num = (v: string | string[] | undefined): number | null => {
  const raw = str(v).replace(/[^0-9]/gu, '');
  return raw === '' ? null : Number(raw);
};

/**
 * Grants that have already been awarded.
 *
 * The question an applicant actually has is "who like us has been given money,
 * how much, and by whom" — and the answer is a list of award records, each one
 * checkable against the funder's own published data.
 *
 * The funder screen answers a different question, one level up: which funders
 * are worth approaching. It was doing so by summarising a whole record into a
 * median and a range, which buried the grants themselves behind a disclosure.
 * This is the level people asked for repeatedly and it was not built.
 *
 * Nothing here is an open call. Every row is money that has gone out already,
 * which is exactly why it is worth reading: behaviour beats a priorities page.
 */
export default async function GrantsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const organisationId = await requireOrganisationId();
  const params = await searchParams;
  const database = await getDatabase();

  const context = await database.withTenant(organisationId, async (tx) => ({
    organisation: await loadOrganisation(tx),
    project: await loadProject(tx),
    held: await countAwards(tx),
    tags: await awardTags(tx),
    regions: await awardRegions(tx),
  }));

  const applicant = {
    region: context.organisation?.profile.region ?? null,
    beneficiaryGroups: context.project?.beneficiaryGroups ?? [],
    amountSoughtGbp: context.project?.amountSoughtGbp ?? null,
  };

  // A first visit lands on grants like theirs, built from what they have
  // already told us — so the screen is useful before anybody types. Once they
  // have touched the form, `q` is present and their choices win, including
  // choices that clear a field.
  const touched = 'q' in params;
  const criteria: GrantSearchCriteria = touched
    ? {
        text: str(params['text']),
        region: str(params['region']),
        tag: str(params['tag']),
        minAmountGbp: num(params['min']),
        maxAmountGbp: num(params['max']),
      }
    : criteriaLikeMine(applicant);

  const { awards, capped } = await database.withTenant(organisationId, (tx) =>
    searchAwards(tx, criteria),
  );

  const attribution = [...new Set(awards.map((a) => a.attribution).filter(Boolean))];

  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">Grants already awarded</p>
        <h1 className="page-title" style={{ marginTop: 'var(--s-2)' }}>
          Who like you has been funded
        </h1>
        <p className="page-sub">
          Every row is a grant that has already been paid out, as the funder published it. It
          is not a list of what is open — no public source carries that — but it is the best
          evidence there is of who gives to work like yours, and how much.
        </p>
      </header>

      <GrantFilters
        criteria={criteria}
        tags={context.tags}
        regions={context.regions}
        derived={!touched && isNarrowed(criteria)}
      />

      {context.held === 0 ? (
        <EmptyState title="No grants have been loaded yet">
          This deployment holds no published award data, so there is nothing to search. An
          operator loads a funder&rsquo;s grants from the console; until then every funding
          screen is empty by construction rather than because nothing fits you.
        </EmptyState>
      ) : awards.length === 0 ? (
        <section className="card" style={{ marginTop: 'var(--s-5)' }}>
          <h2 className="card-title">Nothing matched</h2>
          <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
            {context.held} grant{context.held === 1 ? '' : 's'} are held, and none of them fit
            those filters. Widen the amount range or clear the area — a funder often gives
            outside the places their published grants suggest.
          </p>
        </section>
      ) : (
        <>
          <p className="hint" style={{ marginTop: 'var(--s-5)' }}>
            {capped
              ? `The first ${awards.length} of more than that. Narrow the search to see the rest.`
              : `${awards.length} grant${awards.length === 1 ? '' : 's'} of ${context.held} held.`}
          </p>

          <ul className="facts" style={{ marginTop: 'var(--s-3)' }}>
            {awards.map((award) => {
              const reasons = whySimilar(award, applicant);
              return (
                <li className="fact" key={award.id}>
                  <div className="fact-main">
                    <div className="fact-body">
                      <p className="fact-claim">
                        {award.awardedOn ?? 'Date not published'} · {award.funderName}
                      </p>
                      <p className="fact-value">
                        {gbp(award.amountGbp)}
                        {award.recipientName === null ? '' : ` to ${award.recipientName}`}
                      </p>
                      {award.title === null ? null : (
                        <p className="fact-source" style={{ color: 'var(--ink)' }}>
                          {award.title}
                        </p>
                      )}
                      {award.description === null ? null : (
                        <p className="fact-source">{award.description}</p>
                      )}
                      <p className="fact-source">
                        {[award.region, ...award.tags].filter(Boolean).join(' · ')}
                      </p>
                      {/* Only when they did not ask for it.
                          Under the derived "like mine" search every row
                          matches by construction, so the same two lines
                          repeat down the page and distinguish nothing — the
                          banner above says it once. After a manual search
                          they are informative again, because the result no
                          longer selects for them. */}
                      {touched && reasons.length > 0 ? (
                        <ul className="list" style={{ marginTop: 'var(--s-2)' }}>
                          {reasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                    <div className="fact-do">
                      {/* Quiet, not primary. Consecutive grants share a
                          funder, so a primary button per row is five
                          identical calls to action for one target — the wall
                          the fact list had before it was made a list. */}
                      <a
                        className="link-quiet"
                        href={`/opportunities/add?funder=${encodeURIComponent(award.funderId)}`}
                      >
                        Add a fund from {award.funderName}
                      </a>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {attribution.length === 0 ? null : (
        <p className="ingest-licence" style={{ marginTop: 'var(--s-6)' }}>
          {attribution.join(' · ')}. Published under the terms of each dataset&rsquo;s licence.
        </p>
      )}
    </div>
  );
}
