import { withOperator } from '@/db';
import { checkIsolation } from '@/db/isolation';
import {
  readAccountSummary,
  readCatalogueSummary,
  readThrottleSummary,
} from '@/db/platform';
import { checkConfiguration, readEnvironment } from '@/env';
import { THROTTLE } from '@/domain/auth/throttle';
import { isWriterAvailable } from '@/app/drafting';

import { requireAdmin } from './session';
import { AdminShell } from './AdminShell';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

interface Reading {
  label: string;
  value: string;
  tone: 'good' | 'caution' | 'plain';
  note?: string;
}

function Readings({ title, readings }: { title: string; readings: Reading[] }) {
  return (
    <section className="card" style={{ marginTop: 'var(--s-5)' }}>
      <h2 className="card-title">{title}</h2>
      <dl className="admin-readings">
        {readings.map((reading) => (
          <div className="admin-reading" key={reading.label}>
            <dt>{reading.label}</dt>
            <dd className={`admin-value admin-${reading.tone}`}>{reading.value}</dd>
            {reading.note === undefined ? null : <p className="hint">{reading.note}</p>}
          </div>
        ))}
      </dl>
    </section>
  );
}

export default async function AdminOverviewPage() {
  const session = await requireAdmin();
  const env = readEnvironment();

  // Configuration first: it needs no database, so it still reports when the
  // database is the thing that is wrong.
  const problems = checkConfiguration(env);

  const writerAvailable = await isWriterAvailable();

  let accounts = { total: 0, lastSevenDays: 0 };
  let catalogue = { funders: 0, sharedOpportunities: 0, tenantOpportunities: 0 };
  let throttle = { buckets: 0, blocking: 0 };
  let databaseError: string | null = null;
  try {
    [accounts, catalogue, throttle] = await withOperator(async (tx) => [
      await readAccountSummary(tx),
      await readCatalogueSummary(tx),
      await readThrottleSummary(tx, THROTTLE.address.maxAttempts),
    ]);
  } catch (error) {
    databaseError = error instanceof Error ? error.message : String(error);
  }

  // The self-check reads pg_roles and pg_policies, which needs owner
  // privileges — so it takes its own connection rather than the operator one.
  let isolation = { ok: true, problems: [] as string[] };
  try {
    const report = await checkIsolation();
    isolation = { ok: report.enforced, problems: report.problems };
  } catch (error) {
    isolation = {
      ok: false,
      problems: [error instanceof Error ? error.message : String(error)],
    };
  }

  return (
    <AdminShell email={session.email} active="overview">
      {databaseError === null ? null : (
        <p className="notice notice-caution" role="alert">
          <span aria-hidden="true">⚠</span>
          <span>The platform tables could not be read: {databaseError}</span>
        </p>
      )}

      <Readings
        title="Tenant isolation"
        readings={[
          {
            label: 'Self-check',
            value: isolation.ok ? 'Passing' : 'FAILING',
            tone: isolation.ok ? 'good' : 'caution',
            note: isolation.ok
              ? 'The tenant role holds no bypass, and every table with a policy has row-level security switched on.'
              : isolation.problems.join(' · '),
          },
        ]}
      />

      <Readings
        title="Deployment"
        readings={[
          {
            label: 'Database',
            value: env.databaseUrl === null ? 'In memory (development)' : 'Postgres',
            tone: env.databaseUrl === null && env.isProduction ? 'caution' : 'plain',
            note:
              env.databaseUrl === null
                ? 'Nothing written here survives a restart.'
                : undefined,
          },
          {
            label: 'Drafting',
            value: writerAvailable ? 'Available' : 'No key',
            tone: writerAvailable ? 'good' : 'caution',
            note: writerAvailable
              ? 'Reading guidance and drafting answers work for everybody on this deployment.'
              : 'Nobody can have guidance read for them unless they bring their own key. Everything else — adding a fund by hand, checking eligibility, the tracker — works without one.',
          },
          {
            label: 'Company lookup',
            value: env.companiesHouseBaseUrl === null ? 'Not configured' : 'Configured',
            tone: 'plain',
            note:
              env.companiesHouseBaseUrl === null
                ? 'Organisations enter their own details, recorded as self-declared rather than verified.'
                : undefined,
          },
          {
            label: 'Credential storage',
            value: env.encryptionKey === null ? 'Unavailable' : 'Ready',
            tone: env.encryptionKey === null ? 'caution' : 'good',
            note:
              env.encryptionKey === null
                ? 'APP_ENCRYPTION_KEY is not set, so nobody can save their own API key in Settings.'
                : undefined,
          },
        ]}
      />

      {problems.length === 0 ? null : (
        <section className="card" style={{ marginTop: 'var(--s-5)' }}>
          <h2 className="card-title">Configuration problems</h2>
          <ul className="list" style={{ marginTop: 'var(--s-3)' }}>
            {problems.map((problem) => (
              <li key={problem.variable}>
                <strong>{problem.variable}</strong> — {problem.problem}
                <br />
                <span className="hint">{problem.fix}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Readings
        title="Use"
        readings={[
          { label: 'Accounts', value: String(accounts.total), tone: 'plain' },
          {
            label: 'New in the last 7 days',
            value: String(accounts.lastSevenDays),
            tone: 'plain',
          },
          {
            label: 'Funders known',
            value: String(catalogue.funders),
            tone: 'plain',
          },
          {
            label: 'Funds in the shared catalogue',
            value: String(catalogue.sharedOpportunities),
            tone: catalogue.sharedOpportunities === 0 ? 'caution' : 'plain',
            note:
              catalogue.sharedOpportunities === 0
                ? 'Every new account opens on an empty list until there is something here. Adding funds by hand is the fastest way to change that.'
                : undefined,
          },
          {
            label: 'Funds added by organisations',
            value: String(catalogue.tenantOpportunities),
            tone: 'plain',
            note: 'A count. What they are, and who added them, stays with them.',
          },
        ]}
      />

      <Readings
        title="Sign-in limiter"
        readings={[
          {
            label: 'Buckets in the last hour',
            value: String(throttle.buckets),
            tone: 'plain',
          },
          {
            label: 'Currently turning somebody away',
            value: String(throttle.blocking),
            tone: throttle.blocking > 0 ? 'caution' : 'good',
          },
        ]}
      />
    </AdminShell>
  );
}
