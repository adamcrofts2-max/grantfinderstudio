import { notFound } from 'next/navigation';

import { getDatabase } from '@/db';
import { loadOwnFund, loadRulesInUse } from '@/db/own-funds';
import { findApplicationForOpportunity } from '@/db/workspace';
import { requireOrganisationId } from '@/app/session';
import { ManualFundForm } from '@/app/ManualFundForm';
import { EMPTY_MANUAL_FUND } from '@/app/manualFundState';
import { RemoveFund } from '@/app/opportunities/RemoveFund';
import { BENEFICIARY_CHOICES } from '@/app/onboarding/state';
import { CIC_TREATMENT_NOTE, describeParams, kindLabel } from '@/app/opportunities/add/state';

import { editOwnFundAction, removeRuleAction } from './actions';
import { RuleForm } from './RuleForm';

export const dynamic = 'force-dynamic';

/**
 * A fund you added: its rules, its details, and the way to remove it.
 *
 * Two findings from walking the product as an applicant, both about a fund
 * typed in by hand. It had no eligibility rules and no way to give it any, so
 * its verdict could only ever be "we cannot yet tell" — and it could be
 * neither corrected nor removed, so a typo in the deadline was permanent and
 * a mistake meant a duplicate for ever.
 *
 * Rules come first because they are what the fund's page is for; the details
 * are usually right first time.
 *
 * Only for a fund this organisation added. A shared catalogue fund is visible
 * to everybody and changeable by nobody here, so it is a 404 — the same answer
 * as a fund that does not exist, which says nothing about either.
 */
export default async function EditOwnFundPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const organisationId = await requireOrganisationId();
  const database = await getDatabase();

  const page = await database.withTenant(organisationId, async (tx) => {
    const fund = await loadOwnFund(tx, id);
    if (fund === null) return null;
    return {
      fund,
      rules: await loadRulesInUse(tx, id),
      application: await findApplicationForOpportunity(tx, id),
    };
  });
  if (page === null) notFound();
  const { fund, rules, application } = page;

  const initial = {
    ...EMPTY_MANUAL_FUND,
    values: {
      funderName: fund.funderName,
      title: fund.title,
      sourceUrl: fund.sourceUrl ?? '',
      minAmountGbp: fund.minAmountGbp === null ? '' : String(fund.minAmountGbp),
      maxAmountGbp: fund.maxAmountGbp === null ? '' : String(fund.maxAmountGbp),
      deadlineKind: fund.deadlineKind,
      deadline: fund.deadline ?? '',
      jurisdiction: fund.jurisdiction ?? '',
      summary: fund.summary ?? '',
    },
  };

  return (
    <div className="page page-narrow">
      <p style={{ marginBottom: 'var(--s-4)' }}>
        <a href={`/opportunities/${fund.id}`}>
          <span aria-hidden="true">← </span>Back to the fund
        </a>
      </p>

      <header className="page-head">
        <p className="eyebrow">Your entry for this fund</p>
        <h1 className="page-title" style={{ marginTop: 'var(--s-2)' }}>{fund.title}</h1>
        <p className="opportunity-funder">{fund.funderName}</p>
        <p className="page-sub">
          You added this fund, so its rules and details are yours to keep right. Nobody else sees
          them.
        </p>
      </header>

      <section className="card" id="rules" aria-labelledby="rules-heading">
        <h2 className="card-title" id="rules-heading">
          {rules.length === 0
            ? 'No rules yet'
            : `The ${rules.length === 1 ? 'rule' : `${rules.length} rules`} we check you against`}
        </h2>
        <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
          {rules.length === 0
            ? 'Until this fund has rules, its eligibility can only say “we cannot yet tell”. Take them from the funder’s guidance — who may apply, where, how much, for how long — and each one is checked against your organisation and your project.'
            : 'Each is checked against your organisation and your project, and the result is on the fund’s page. Add any the guidance states that are missing.'}
        </p>

        {rules.length === 0 ? null : (
          <ul className="rules-in-use">
            {rules.map((rule) => {
              const typed = rule.proposedBy === 'user';
              // A typed rule's label is built from its own terms, so the
              // terms again underneath would say the same thing twice. A rule
              // read from guidance was named by the model, and its terms are
              // the check on that name.
              const detail = typed ? '' : describeParams(rule.kind, rule.params);
              const cicNote =
                rule.cicHandling === null ||
                (typed && rule.cicHandling === 'explicitly_permitted')
                  ? null
                  : (CIC_TREATMENT_NOTE[rule.cicHandling] ?? null);
              return (
                <li className="rule-in-use" key={rule.id}>
                  <div className="rule-in-use-body">
                    <p className="eyebrow">{kindLabel(rule.kind)}</p>
                    <p className="rule-in-use-label">{rule.label}</p>
                    {detail === '' || detail === rule.label ? null : (
                      <p className="criteria-why">{detail}</p>
                    )}
                    {cicNote === null ? null : <p className="criteria-why">{cicNote}</p>}
                    {rule.sourceSpan === null ? null : (
                      <blockquote className="quote" style={{ marginTop: 'var(--s-2)' }}>
                        <q>{rule.sourceSpan}</q>
                      </blockquote>
                    )}
                    <p className="hint">
                      {typed
                        ? 'You added this.'
                        : 'Read from their guidance, and checked by you.'}
                    </p>
                  </div>
                  <form action={removeRuleAction}>
                    <input type="hidden" name="criterionId" value={rule.id} />
                    <input type="hidden" name="opportunityId" value={fund.id} />
                    <input type="hidden" name="kind" value={rule.kind} />
                    <button className="link-quiet" type="submit">
                      Stop using this
                      <span className="sr-only"> — {rule.label}</span>
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}

        {/* Not folded. It was a disclosure open only while there were no
            rules — so saving the first one re-rendered it closed, and the
            person adding their second rule found the form gone from under
            them. Adding rules is what this page is for. */}
        <div className="rule-add">
          <h3 className="rule-add-title">
            {rules.length === 0 ? 'Add the first rule' : 'Add another rule'}
          </h3>
          <RuleForm opportunityId={fund.id} beneficiaryChoices={BENEFICIARY_CHOICES} />
        </div>
      </section>

      <details className="card paste" id="details">
        <summary className="paste-summary">
          <span>The fund’s details</span>
          <span className="chev chev-toggle" aria-hidden="true" />
        </summary>
        <div className="paste-body">
          {fund.pasted ? (
            <p className="hint" style={{ marginBottom: 'var(--s-4)' }}>
              These were read from the guidance you pasted. Correct anything we read wrongly —
              the guidance itself is kept as you gave it.
            </p>
          ) : null}
          <ManualFundForm
            action={editOwnFundAction.bind(null, fund.id)}
            submitLabel="Save changes"
            initial={initial}
          />
        </div>
      </details>

      <RemoveFund
        opportunityId={fund.id}
        title={fund.title}
        application={
          application === null
            ? null
            : { answered: application.answered, total: application.total }
        }
      />
    </div>
  );
}
