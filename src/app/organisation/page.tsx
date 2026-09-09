import { getDatabase } from '@/db';
import { requireOrganisationId } from '@/app/session';
import { readSetupProgress } from '@/app/setup';
import { loadFacts } from '@/db/workspace';

import { AddFact } from './AddFact';
import { FactList, type FactView } from './FactList';

export const dynamic = 'force-dynamic';

/**
 * What we know about the organisation, and who vouched for it.
 *
 * This screen is the hinge of the whole product. Extraction and register
 * lookups produce candidates; a person turns them into facts here; only then
 * may the Writer rely on them. Skipping it would mean a funding application
 * resting on something nobody checked.
 */
export default async function OrganisationPage() {
  const organisationId = await requireOrganisationId();
  const database = await getDatabase();
  const facts = await database.withTenant(organisationId, (tx) => loadFacts(tx));

  // Open the form when this is what somebody was sent here to do. A guide that
  // says "tell us about yourself", links to #add-fact and lands you on a
  // collapsed row has let go at the moment it was leading — the same failure
  // the project form had on onboarding.
  const progress = await readSetupProgress();
  const nextIsFacts = progress?.next?.id === 'facts';
  const nothingPending = facts.every((fact) => fact.confirmedBy !== null);

  const view: FactView[] = facts.map((fact) => ({
    id: fact.id,
    claim: fact.claim,
    value: fact.value,
    source: fact.sourceType,
    sourceSpan: fact.sourceSpan,
    confidence: fact.confidence,
    confirmed: fact.confirmedBy !== null,
  }));

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <p className="eyebrow">Your organisation</p>
        <h1 className="page-title" style={{ marginTop: 'var(--s-2)' }}>
          What we know about you
        </h1>
        <p className="page-sub">
          Gathered from Companies House, the documents you have shared, and whatever you tell
          us here. Check each one — your applications are written from these and nothing else.
        </p>
      </header>

      <FactList facts={view} />

      <div style={{ marginTop: 'var(--s-5)' }}>
        <AddFact
          known={facts.map((fact) => fact.claim)}
          open={nextIsFacts && nothingPending}
        />
      </div>
    </div>
  );
}
