import { describe, expect, it } from 'vitest';

import {
  COMPANIES_HOUSE_BASE_URL_KEY,
  SETTINGS,
  THREESIXTYGIVING_BASE_URL_KEY,
  THREESIXTYGIVING_MAX_PAGES_KEY,
  effectiveSetting,
  settingByKey,
  settingProblem,
} from './registry.js';

const url = settingByKey(THREESIXTYGIVING_BASE_URL_KEY)!;
const pages = settingByKey(THREESIXTYGIVING_MAX_PAGES_KEY)!;

describe('the registry', () => {
  it('has no duplicate keys', () => {
    expect(new Set(SETTINGS.map((s) => s.key)).size).toBe(SETTINGS.length);
  });

  it('gives every setting a usable default', () => {
    for (const setting of SETTINGS) {
      expect(settingProblem(setting, setting.fallback), setting.key).toBeNull();
    }
  });

  it('does not know a key it was not given', () => {
    expect(settingByKey('nope')).toBeNull();
  });
});

describe('validating a base URL', () => {
  it('accepts the real one', () => {
    expect(settingProblem(url, 'https://api.threesixtygiving.org/api/v1/')).toBeNull();
  });

  it('refuses http, because these requests carry keys or are followed', () => {
    expect(settingProblem(url, 'http://api.threesixtygiving.org/')).toContain('https');
  });

  it('refuses something that is not a URL', () => {
    expect(settingProblem(url, 'api.threesixtygiving.org')).toContain('not a URL');
  });

  it('refuses empty, and says how to get the default back', () => {
    expect(settingProblem(url, '   ')).toContain('Clear it');
  });
});

describe('validating a number', () => {
  it('accepts one in range', () => {
    expect(settingProblem(pages, '120')).toBeNull();
  });

  it('refuses words', () => {
    expect(settingProblem(pages, 'lots')).toContain('whole number');
  });

  it('refuses below the minimum', () => {
    expect(settingProblem(pages, '0')).toContain('at least 1');
  });

  it('refuses above the maximum', () => {
    expect(settingProblem(pages, '9999')).toContain('500 or less');
  });
});

describe('which value is in force', () => {
  it('prefers the database, because the console is live and a redeploy is not', () => {
    const found = effectiveSetting(url, 'https://mirror.example.org/', {
      THREESIXTYGIVING_BASE_URL: 'https://env.example.org/',
    });
    expect(found.value).toBe('https://mirror.example.org/');
    expect(found.source).toBe('database');
  });

  it('falls back to the environment, which is how a new deployment configures itself', () => {
    const found = effectiveSetting(url, undefined, {
      THREESIXTYGIVING_BASE_URL: 'https://env.example.org/',
    });
    expect(found.value).toBe('https://env.example.org/');
    expect(found.source).toBe('environment');
  });

  it('falls back to the built-in default last', () => {
    const found = effectiveSetting(url, undefined, {});
    expect(found.value).toBe(url.fallback);
    expect(found.source).toBe('default');
  });

  it('treats a blank stored value as unset rather than as an override', () => {
    const found = effectiveSetting(url, '   ', { THREESIXTYGIVING_BASE_URL: 'https://env.example.org/' });
    expect(found.source).toBe('environment');
  });

  it('treats a blank environment value the same way', () => {
    expect(effectiveSetting(url, undefined, { THREESIXTYGIVING_BASE_URL: '  ' }).source).toBe(
      'default',
    );
  });

  it('uses the default for a setting with no environment variable at all', () => {
    const noEnv = { ...url, envVar: undefined };
    expect(effectiveSetting(noEnv, undefined, { ANYTHING: 'x' }).source).toBe('default');
  });
});

describe('Companies House', () => {
  it('keeps the environment variable the deployment already documents', () => {
    const ch = settingByKey(COMPANIES_HOUSE_BASE_URL_KEY)!;
    expect(ch.envVar).toBe('COMPANIES_HOUSE_BASE_URL');
  });
});
