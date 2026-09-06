import { withAdmin } from '@/db/dev-database';
import { readCredentialStatuses } from '@/secrets/store';
import { KeyForm, type ProviderCopy } from './KeyForm';

export const dynamic = 'force-dynamic';

/**
 * Operator settings.
 *
 * These are the platform's own service credentials. A CIC using the product
 * never sees this screen and is never asked for an API key — they sign up and
 * the platform pays for and manages its own provider access. Wording on this
 * page is written for whoever runs the service, not for a grant applicant.
 */
const PROVIDERS: ProviderCopy[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    what: 'Powers document reading, drafting and application review.',
    whereToGet: 'Create a key in the Anthropic Console under API keys.',
    url: 'https://console.anthropic.com/settings/keys',
    placeholder: 'sk-ant-api03-…',
  },
  {
    id: 'companies_house',
    name: 'Companies House',
    what: 'Verifies a CIC’s company number, legal form and incorporation date.',
    whereToGet: 'Register a free application on the Companies House developer hub.',
    url: 'https://developer.company-information.service.gov.uk/',
    placeholder: 'Your Companies House REST API key',
  },
];

export default async function SettingsPage() {
  // Operator credentials belong to no tenant, so this deliberately does not
  // go through the tenant connection.
  const statuses = await withAdmin((tx) => readCredentialStatuses(tx));

  const connected = PROVIDERS.filter((p) => statuses[p.id].lastCheckOk === true).length;

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <p className="eyebrow">Settings</p>
        <h1 className="page-title" style={{ marginTop: 'var(--s-2)' }}>
          Service connections
        </h1>
        <p className="page-sub">
          The services Grant Finder Studio uses on your behalf. These are the platform’s own
          keys — the CICs using this product never see them and are never asked for one.
        </p>
        <p className="page-sub" style={{ marginTop: 'var(--s-3)' }}>
          <strong>
            {connected} of {PROVIDERS.length} connected.
          </strong>{' '}
          Keys are encrypted before they are stored and are never shown again after saving.
        </p>
      </header>

      {PROVIDERS.map((provider) => (
        <KeyForm key={provider.id} provider={provider} status={statuses[provider.id]} />
      ))}

      <section className="card">
        <h2 className="card-title">How keys are handled</h2>
        <ul style={{ margin: 'var(--s-3) 0 0', paddingLeft: '1.1rem', color: 'var(--ink-soft)', fontSize: 'var(--t-sm)' }}>
          <li style={{ marginBottom: 'var(--s-2)' }}>
            Encrypted with AES-256-GCM before being written to the database.
          </li>
          <li style={{ marginBottom: 'var(--s-2)' }}>
            Never sent back to the browser — only the masked form above is ever rendered.
          </li>
          <li style={{ marginBottom: 'var(--s-2)' }}>
            Never written to logs, and stripped from any provider error message.
          </li>
          <li>
            Tested against the provider when you save, so “Connected” means it genuinely works.
          </li>
        </ul>
      </section>
    </div>
  );
}
