import { getDatabase } from '@/db';
import { loadFacts } from '@/db/workspace';
import { DEMO_ORG_ID } from '@/demo/seed';
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
  const database = await getDatabase();
  const facts = await database.withTenant(DEMO_ORG_ID, (tx) => loadFacts(tx));

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
          Gathered from Companies House and the documents you have shared. Check each one — your
          applications are written from these and nothing else.
        </p>
      </header>

      <FactList facts={view} />
    </div>
  );
}
