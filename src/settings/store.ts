/**
 * Reading and writing the platform's operational settings.
 *
 * OWNER scope, like `app_credentials`. `app_settings` is granted to no
 * application role at all (0010): a role that could rewrite the base URL of an
 * outbound request could point it at anything.
 */

import type { Queryable } from '../db/client.js';
import {
  SETTINGS,
  effectiveSetting,
  settingByKey,
  settingProblem,
  type EffectiveSetting,
} from './registry.js';

export async function readStoredSettings(
  tx: Queryable,
): Promise<Record<string, string>> {
  const { rows } = await tx.query<{ key: string; value: string }>(
    'SELECT key, value FROM app_settings',
  );
  const stored: Record<string, string> = {};
  for (const row of rows) stored[row.key] = row.value;
  return stored;
}

/** Every setting, with the value in force and where it came from. */
export async function readEffectiveSettings(
  tx: Queryable,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<EffectiveSetting[]> {
  const stored = await readStoredSettings(tx);
  return SETTINGS.map((definition) => effectiveSetting(definition, stored[definition.key], env));
}

/** One setting's value in force. For the code that actually makes the request. */
export async function readSetting(
  tx: Queryable,
  key: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<string> {
  const definition = settingByKey(key);
  if (definition === null) throw new Error(`Unknown setting: ${key}`);
  const stored = await readStoredSettings(tx);
  return effectiveSetting(definition, stored[key], env).value;
}

export class SettingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingError';
  }
}

/**
 * Store a value, or clear it to fall back to the environment or the default.
 *
 * Validated here as well as in the form: a server action is a public endpoint,
 * and the check that matters is the one nearest the write.
 */
export async function saveSetting(
  tx: Queryable,
  key: string,
  raw: string,
  adminId: string | null,
): Promise<void> {
  const definition = settingByKey(key);
  if (definition === null) throw new SettingError(`Unknown setting: ${key}`);

  const value = raw.trim();
  if (value === '') {
    // Clearing is how you go back to the environment or the default, and it
    // has to be possible: otherwise a mistyped base URL is permanent.
    await tx.query('DELETE FROM app_settings WHERE key = $1', [key]);
    return;
  }

  const problem = settingProblem(definition, value);
  if (problem !== null) throw new SettingError(problem);

  await tx.query(
    `INSERT INTO app_settings (key, value, updated_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET
       value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, value, adminId],
  );
}
