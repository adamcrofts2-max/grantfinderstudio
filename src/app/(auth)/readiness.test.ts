import { describe, expect, it } from 'vitest';

import { checkConfiguration, type AppEnvironment } from '@/env';

/**
 * What sign-up is allowed to be blocked by.
 *
 * Blocking it on any configuration problem at all locked people out of a
 * deployment whose only fault was having no encryption key — which sign-up
 * never touches.
 */
const env = (over: Partial<AppEnvironment> = {}): AppEnvironment => ({
  databaseUrl: 'postgres://x/y?sslmode=require',
  encryptionKey: null,
  companiesHouseBaseUrl: null,
  isProduction: true,
  ...over,
});

const blocking = (e: AppEnvironment) =>
  checkConfiguration(e).filter((p) => p.variable === 'DATABASE_URL');

describe('configuration that blocks signing up', () => {
  it('does not include a missing encryption key', () => {
    // It stops API keys being stored. It has nothing to do with accounts.
    expect(checkConfiguration(env()).some((p) => p.variable === 'APP_ENCRYPTION_KEY')).toBe(true);
    expect(blocking(env())).toEqual([]);
  });

  it('does include a missing database', () => {
    expect(blocking(env({ databaseUrl: null }))).toHaveLength(1);
  });

  it('does include a database reached without TLS', () => {
    expect(blocking(env({ databaseUrl: 'postgres://x/y' }))).toHaveLength(1);
  });
});
