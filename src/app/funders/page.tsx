import { EmptyState } from '@/app/illustration/EmptyState';
import { getDatabase } from '@/db';
import { requireOrganisationId } from '@/app/session';
import { loadAllFunderAwards, loadOrganisation, loadProject } from '@/db/queries';

import { findProspects, type Prospect, type ProspectTier } from '@/domain/prospect/match';
import { gbp } from '@/app/components';
import { DistributionBar } from '@/app/viz/DistributionBar';

export const dynamic = 'force-dynamic';

const TIER = {
  area_and_cause: {
    title: 'Funded your kind of work, in your area',
    blurb: 'The strongest evidence available: they have already given to work like yours, near you.',
    badge: { label: 'Closest match', className: 'badge badge-positive', mark: '✓' },
  },
  cause: {
    title: 'Funded your kind of work, elsewhere',
    blurb: 'They fund what you do, but their published grants are outside your area. Worth checking whether they are restricted by geography.',
    badge: { label: 'Your cause', className: 'badge badge-accent', mark: '·' },
  },
  area: {
    title: 'Funded in your area, for other things',
    blurb: 'They give locally but nothing published matches what you do. Some funders are broader than their grants suggest.',
    badge: { label: 'Your area', className: 'badge badge-accent', mark: '·' },
  },
  no_overlap: {
    title: 'No overlap in what they have published',
    blurb: 'Nothing they have funded looks like your work or your area.',
    badge: { label: 'No overlap', className: 'badge badge-neutral', mark: '·' },
  },
  not_characterised: {
    title: 'Too little published to say',
    blurb: 'Fewer than five published grants. That is not enough to describe what a funder does, so we do not try.',
    badge: { label: 'Not enough data', className: 'badge badge-neutral', mark: '?' },
  },
} as const satisfies Record<ProspectTier, unknown>;

const ORDER: ProspectTier[] = ['area_and_cause', 'cause', 'area', 'no_overlap', 'not_characterised'];

function ProspectCard({ prospect, yourAskGbp }: { prospect: Prospect; yourAskGbp: number | null }) {
  const badge = TIER[prospect.tier].badge;
  return (
    <section className="card">
      <div className="row-between">
        <div style={{ flex: '1 1 20rem', minWidth: 0 }}>
          <h3 className="opportunity-title">{prospect.funderName}</h3>
          {prospect.amounts === null ? null : (
            <div style={{ margin: 'var(--s-3) 0 var(--s-4)' }}>
              <DistributionBar
                amounts={prospect.amounts}
                yourAskGbp={yourAskGbp}
                funderName={prospect.funderName}
              />
            </div>
          )}

          <ul className="list" style={{ marginTop: 'var(--s-2)' }}>
            {prospect.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>

          {prospect.matchingAwards.length > 0 ? (
            <details style={{ marginTop: 'var(--s-3)' }}>
              <summary className="hint">
                See the {prospect.matchingAwards.length === 1 ? 'grant' : 'grants'} behind this
              </summary>
              <ul className="list" style={{ marginTop: 'var(--s-2)' }}>
                {prospect.matchingAwards.slice(0, 8).map((a) => (
                  <li key={a.id}>
                    {gbp(a.amountGbp)} · {a.awardedOn}
                    {a.recipientName === null ? '' : ` · ${a.recipientName}`}
                    {a.region === null ? '' : ` · ${a.region}`}
                    {a.tags.length === 0 ? '' : ` · ${a.tags.join(', ')}`}
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
        </div>
      </div>
    </section>
  );
}

/**
 * Who has funded work like yours.
 *
 * This is the half of "search" that can honestly be built. There is no
 * register of open UK trust calls, but there is a public record of what
 * funders have already done — and that answers the more useful question.
 *
 * Nothing here says a funder will fund you. It says what they have funded, and
 * shows the grants, so the claim can be checked rather than trusted.
 */
export default async function FundersPage() {
  const organisationId = await requireOrganisationId();
  const database = await getDatabase();
  const asOf = new Date().toISOString().slice(0, 10);

  const page = await database.withTenant(organisationId, async (tx) => ({
    organisation: await loadOrganisation(tx),
    project: await loadProject(tx),
    funders: await loadAllFunderAwards(tx),
  }));

  const { organisation, project } = page;
  const prospects =
    organisation === null
      ? []
      : findProspects(
          page.funders,
          {
            jurisdiction: organisation.profile.jurisdiction,
            region: organisation.profile.region,
            beneficiaryGroups: project?.beneficiaryGroups ?? [],
            amountSoughtGbp: project?.amountSoughtGbp ?? null,
          },
          asOf,
        );

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <p className="eyebrow">Funders</p>
        <h1 className="page-title" style={{ marginTop: 'var(--s-2)' }}>
          Who funds work like yours
        </h1>
        <p className="page-sub">
          Nobody publishes a list of what UK trusts have open. They do publish what they have
          already given, and that is a better question anyway — a funder’s record says more than
          their priorities page. Every line below is countable, and you can open the grants
          behind it.
        </p>
      </header>

      {organisation === null ? (
        <EmptyState
          title="We do not know who you are yet"
          action={<a className="btn btn-primary" href="/onboarding">Add your organisation</a>}
        >
          Tell us your area and what you do, and we can match it against what funders have
          actually given.
        </EmptyState>
      ) : null}

      {organisation !== null && (project?.beneficiaryGroups.length ?? 0) === 0 ? (
        <p className="notice notice-caution">
          <span aria-hidden="true">⚠</span>
          <span>
            You have not said who benefits from your work, so nothing below can be matched on
            cause — only on area. <a href="/onboarding">Add that</a> and this list gets much
            sharper.
          </span>
        </p>
      ) : null}

      {ORDER.map((tier) => {
        const group = prospects.filter((p) => p.tier === tier);
        if (group.length === 0) return null;
        return (
          <section key={tier} style={{ marginTop: 'var(--s-6)' }}>
            <h2 className="card-title">
              {TIER[tier].title}{' '}
              <span className="metric-label" style={{ textTransform: 'none' }}>
                ({group.length})
              </span>
            </h2>
            <p className="card-sub" style={{ marginBottom: 'var(--s-4)', maxWidth: '46rem' }}>
              {TIER[tier].blurb}
            </p>
            <div className="stack">
              {group.map((p) => (
                <ProspectCard
                  key={p.funderId}
                  prospect={p}
                  yourAskGbp={project?.amountSoughtGbp ?? null}
                />
              ))}
            </div>
          </section>
        );
      })}

      <section className="card" style={{ marginTop: 'var(--s-6)' }}>
        <h2 className="card-title">What this is and is not</h2>
        <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
          This describes grants funders have published, nothing more. It does not say anyone will
          fund you, and it cannot tell you whether they are open right now — no public source
          carries that. When you find a fund that looks right,{' '}
          <a href="/opportunities/add">paste its guidance in</a> and we will read the rules with
          you.
        </p>
        <p className="hint" style={{ marginTop: 'var(--s-3)' }}>
          A funder with nothing published recently may have stopped giving, or may simply have
          stopped publishing — the two look identical from here, so we show you the date and let
          you judge.
        </p>
      </section>
    </div>
  );
}
