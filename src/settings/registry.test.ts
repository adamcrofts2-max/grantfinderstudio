import { describe, expect, it } from 'vitest';

import {
  KEYED_SERVICES,
  SETTINGS,
  type SettingDefinition,
  type SettingKind,
  THREESIXTYGIVING_BASE_URL_KEY,
  THREESIXTYGIVING_MAX_PAGES_KEY,
  effectiveSetting,
  settingByKey,
  settingProblem,
  THREESIXTYGIVING_SEARCH_PATH_KEY,
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

/** The rule, as a function, so both cases below test the same thing. */
const offending = (setting: {
  kind: SettingKind;
  service: SettingDefinition['service'];
}): boolean => setting.kind === 'url' && KEYED_SERVICES.includes(setting.service);

describe('the rule about keyed services', () => {
  it('registers no base URL for a service whose requests carry a secret', () => {
    // A key is encrypted and masked so it is write-only. A console-editable
    // base URL undoes that: point the service at a host you control, wait for
    // the next request, and the Authorization header arrives on your server.
    // The key becomes readable by redirect, by somebody who could not read it
    // any other way.
    const offenders = SETTINGS.filter(
      (setting) => setting.kind === 'url' && KEYED_SERVICES.includes(setting.service),
    );
    expect(offenders.map((s) => s.key)).toEqual([]);
  });

  it('is about where a request GOES, not about keyed services in general', () => {
    // A timeout or a page cap for a keyed service would be fine; only the URL
    // is dangerous, because only the URL decides who receives the header.
    expect(offending({ kind: 'integer', service: 'anthropic' })).toBe(false);
    expect(offending({ kind: 'url', service: 'anthropic' })).toBe(true);
    expect(offending({ kind: 'url', service: 'threesixtygiving' })).toBe(false);
  });
});

describe('the grant search route', () => {
  const route = settingByKey(THREESIXTYGIVING_SEARCH_PATH_KEY)!;

  it('defaults to the route 360Giving actually declares', () => {
    // Root-relative on purpose: `experimental/` is mounted on `api/`, not on
    // `api/v1/`, so a base-relative path lands somewhere that 404s. And no
    // trailing slash — their path is declared without one and Django's
    // APPEND_SLASH only ever adds one.
    expect(route.fallback).toBe('/api/experimental/CurrentLatestGrants');
  });

  it('exists, so a route that moves needs no redeploy', () => {
    // 360Giving label the all-grants search experimental, which makes
    // "correctable without shipping code" a requirement, not a convenience.
    expect(route.envVar).toBe('THREESIXTYGIVING_SEARCH_PATH');
  });

  it('accepts both a root-relative and a base-relative route', () => {
    expect(settingProblem(route, '/api/experimental/CurrentLatestGrants')).toBeNull();
    expect(settingProblem(route, 'grants/')).toBeNull();
  });

  it('refuses a full address, which would move requests to another origin', () => {
    // The field is labelled "route" and resolved against the base URL. An
    // absolute URL here would be a way to redirect every search elsewhere
    // through a box that does not look like it could.
    expect(settingProblem(route, 'https://elsewhere.example/api/')).toContain(
      'not a full address',
    );
    expect(settingProblem(route, '//elsewhere.example/api/')).toContain('not a full address');
  });

  it('refuses a protocol-relative address, a full address wearing a slash', () => {
    // `//elsewhere.example/api/` resolves to another ORIGIN, which is the
    // thing this field must never be able to do. A single leading slash
    // cannot — it keeps the host — so it is allowed, and has to be: the
    // all-grants search is mounted beside the versioned API, not under it.
    expect(settingProblem(route, '//elsewhere.example/api/')).toContain('not a full address');
  });

  it('refuses "..", so a route cannot climb out of the API', () => {
    // The other way to leave the intended path: `../../` walks up to the host
    // root. Refused rather than normalised, so what is saved is what is sent.
    expect(settingProblem(route, '../../admin/')).toContain('climb out');
  });

  it('refuses a query string or anything else surprising', () => {
    expect(settingProblem(route, 'grants/?search=x')).toContain('letters, digits');
  });
});
