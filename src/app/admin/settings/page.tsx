import { withAdmin } from '@/db';
import { readCredentialStatuses } from '@/secrets/store';
import { readEffectiveSettings } from '@/settings/store';
import type { EffectiveSetting } from '@/settings/registry';

import { requireAdmin } from '../session';
import { AdminShell } from '../AdminShell';
import { KeyForm, type ProviderCopy } from './KeyForm';
import { SettingForm } from './SettingForm';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * The platform's outbound services.
 *
 * This screen used to live at `/settings`, inside the tenant application, in
 * the customer navigation, with NO guard of any kind — not an admin check, not
 * even a session check. Anyone who could reach the deployment could read which
 * platform keys were configured and their masked form, overwrite them, or
 * delete them. It is the console's business, and it is here now.
 *
 * Two kinds of thing, deliberately kept apart:
 *
 *   - KEYS are secrets. Encrypted, never shown again, replaced rather than
 *     edited, and verified against the provider when saved.
 *   - SETTINGS are not secret. Read back in full, edited in place, and each
 *     one says whether it is coming from here, from the environment, or from
 *     the built-in default.
 */
const PROVIDERS: ProviderCopy[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    what: 'Reads pasted guidance into eligibility rules, reads documents into facts, and drafts application answers. Everything else in the product works without it.',
    whereToGet: 'Create a key in the Anthropic Console under API keys.',
    url: 'https://console.anthropic.com/settings/keys',
    placeholder: 'sk-ant-api03-…',
  },
  {
    id: 'companies_house',
    name: 'Companies House',
    what: 'Looks up a CIC’s company number, legal form and incorporation date so they are verified rather than self-declared.',
    whereToGet: 'Register a free application on the Companies House developer hub.',
    url: 'https://developer.company-information.service.gov.uk/',
    placeholder: 'Your Companies House REST API key',
  },
];

const SERVICE_TITLE: Record<EffectiveSetting['definition']['service'], string> = {
  threesixtygiving: '360Giving',
  companies_house: 'Companies House',
  anthropic: 'Anthropic',
};

export default async function AdminSettingsPage() {
  const session = await requireAdmin();

  const [statuses, settings] = await withAdmin(async (tx) => [
    await readCredentialStatuses(tx),
    await readEffectiveSettings(tx),
  ]);

  const byService = new Map<string, EffectiveSetting[]>();
  for (const setting of settings) {
    const list = byService.get(setting.definition.service) ?? [];
    list.push(setting);
    byService.set(setting.definition.service, list);
  }

  return (
    <AdminShell email={session.email} active="settings">
      <section className="card">
        <h2 className="card-title">Keys</h2>
        <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
          The platform’s own credentials. The CICs using this product never see them and are
          never asked for one. Keys are encrypted before they are stored and are never shown
          again after saving.
        </p>
      </section>

      {PROVIDERS.map((provider) => (
        <KeyForm key={provider.id} provider={provider} status={statuses[provider.id]} />
      ))}

      <section className="card" style={{ marginTop: 'var(--s-5)' }}>
        <h2 className="card-title">Service settings</h2>
        <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
          Not secrets — where each service is reached and how hard it may be pushed. A value
          set here beats one from the hosting environment, because this takes effect now and
          that needs a redeploy. Each says which is in force.
        </p>

        {[...byService.entries()].map(([service, group]) => (
          <div className="setting-group" key={service}>
            <h3 className="setting-service">
              {SERVICE_TITLE[service as EffectiveSetting['definition']['service']] ?? service}
              {service === 'threesixtygiving' ? (
                <span className="badge badge-neutral">No key needed</span>
              ) : null}
            </h3>
            {service === 'threesixtygiving' ? (
              <p className="hint" style={{ marginBottom: 'var(--s-4)' }}>
                360Giving is an open, unauthenticated API — there is no key to hold, which is
                why it appears here and not above. Loading a funder’s grants is on the{' '}
                <a href="/admin/funders">Funders</a> tab.
              </p>
            ) : null}
            {group.map((setting) => (
              <SettingForm key={setting.definition.key} setting={setting} />
            ))}
          </div>
        ))}
      </section>
    </AdminShell>
  );
}
