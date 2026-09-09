/**
 * The platform's operational settings.
 *
 * Not secrets — those are `app_credentials`, encrypted and write-only. These
 * are the things that are safe to read back and that an operator should be
 * able to change without a redeploy: where an outbound request goes, and how
 * hard it is allowed to push.
 *
 * Declarative on purpose. Adding a service means adding entries here; the
 * store, the console screen and the validation all follow from the list, so
 * there is no second place to remember to update.
 *
 * Pure and zero I/O, like the rest of the domain layer.
 */

export type SettingKind = 'url' | 'integer';

export interface SettingDefinition {
  key: string;
  /** Which service this belongs to, for grouping on the console. */
  service: 'threesixtygiving' | 'companies_house' | 'anthropic';
  label: string;
  help: string;
  kind: SettingKind;
  /** Used when neither the database nor the environment says otherwise. */
  fallback: string;
  /**
   * An environment variable consulted when the database is silent.
   *
   * Kept so a deployment can still configure itself before an admin account
   * exists — which is the state every new deployment starts in.
   */
  envVar?: string;
  min?: number;
  max?: number;
}

export const THREESIXTYGIVING_BASE_URL_KEY = 'threesixtygiving.baseUrl';
export const THREESIXTYGIVING_MAX_PAGES_KEY = 'threesixtygiving.maxPages';

/**
 * THE RULE: a base URL for a service whose requests carry a secret does not
 * belong here.
 *
 * A key is encrypted at rest and masked afterwards precisely so that it is
 * write-only — nobody, admin included, can read it back. A console-editable
 * base URL quietly undoes that: point Companies House at a host you control,
 * wait for the next lookup, and the `Authorization: Basic <key>` header
 * arrives on your server. The key becomes readable by redirect.
 *
 * So `COMPANIES_HOUSE_BASE_URL` stays an environment variable, which needs a
 * redeploy and leaves a trace in the hosting platform. 360Giving is the
 * opposite case and is fine here: it is unauthenticated, so a redirected
 * request carries nothing worth stealing, and its pagination links are checked
 * against whatever origin is configured either way.
 *
 * `noUrlSettingForKeyedServices` in the tests enforces this, so the rule
 * survives somebody adding an entry without reading this comment.
 */

export const SETTINGS: readonly SettingDefinition[] = [
  {
    key: THREESIXTYGIVING_BASE_URL_KEY,
    service: 'threesixtygiving',
    label: 'API base URL',
    help: 'The 360Giving API. Change it only to point at a mirror or a staging copy — pagination links are checked against this origin, so a request can never be walked somewhere else.',
    kind: 'url',
    fallback: 'https://api.threesixtygiving.org/api/v1/',
    envVar: 'THREESIXTYGIVING_BASE_URL',
  },
  {
    key: THREESIXTYGIVING_MAX_PAGES_KEY,
    service: 'threesixtygiving',
    label: 'Pages per ingest',
    help: 'A guard against a paginating loop and against an unexpectedly enormous publisher. At 60 grants a page, 50 pages is about 3,000 grants — raise it for a funder who has more.',
    kind: 'integer',
    fallback: '50',
    envVar: 'THREESIXTYGIVING_MAX_PAGES',
    min: 1,
    max: 500,
  },
] as const;

/**
 * Services the platform holds a credential for. Kept here rather than imported
 * from `secrets/store` so this module stays pure and dependency-free.
 */
export const KEYED_SERVICES: readonly SettingDefinition['service'][] = [
  'anthropic',
  'companies_house',
];

export function settingByKey(key: string): SettingDefinition | null {
  return SETTINGS.find((setting) => setting.key === key) ?? null;
}

/**
 * What is wrong with a proposed value, in words an operator can act on.
 *
 * A base URL is the address of every outbound request for that service, so it
 * is checked harder than it looks: https only, because these carry a key or
 * are followed by a paginator, and http would put both on the wire in clear.
 */
export function settingProblem(definition: SettingDefinition, raw: string): string | null {
  const value = raw.trim();
  if (value === '') return 'This cannot be empty. Clear it to go back to the default instead.';

  if (definition.kind === 'url') {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return 'That is not a URL.';
    }
    if (url.protocol !== 'https:') {
      return 'Must be https. Every request to this service either carries a key or is followed by a paginator.';
    }
    return null;
  }

  if (!/^\d+$/u.test(value)) return 'Use a whole number.';
  const parsed = Number(value);
  if (definition.min !== undefined && parsed < definition.min) {
    return `Must be at least ${definition.min}.`;
  }
  if (definition.max !== undefined && parsed > definition.max) {
    return `Must be ${definition.max} or less.`;
  }
  return null;
}

export type SettingSource = 'database' | 'environment' | 'default';

export interface EffectiveSetting {
  definition: SettingDefinition;
  value: string;
  source: SettingSource;
}

/**
 * Which value is actually in force, and where it came from.
 *
 * Database first, then environment, then the built-in default.
 *
 * The database wins because the console is live and an environment variable
 * needs a redeploy: an operator who changes something here and sees no effect
 * has been lied to. The source is carried alongside the value and shown on
 * the screen, so the reverse confusion — changing an environment variable and
 * wondering why nothing happened — is answered before it is asked.
 */
export function effectiveSetting(
  definition: SettingDefinition,
  stored: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
): EffectiveSetting {
  const fromDatabase = stored?.trim();
  if (fromDatabase !== undefined && fromDatabase !== '') {
    return { definition, value: fromDatabase, source: 'database' };
  }
  const fromEnv = definition.envVar === undefined ? undefined : env[definition.envVar]?.trim();
  if (fromEnv !== undefined && fromEnv !== '') {
    return { definition, value: fromEnv, source: 'environment' };
  }
  return { definition, value: definition.fallback, source: 'default' };
}
