import { describe, expect, it } from 'vitest';
import { checkConfiguration, readEnvironment, type EnvironmentSource } from './env.js';

const KEY = Buffer.alloc(32, 7).toString('base64');

function env(overrides: EnvironmentSource = {}): EnvironmentSource {
  return { NODE_ENV: 'production', APP_ENCRYPTION_KEY: KEY, DATABASE_URL: 'postgres://u:p@h/d?sslmode=require', ...overrides };
}

describe('readEnvironment', () => {
  it('reads the values it needs', () => {
    const e = readEnvironment(env());
    expect(e.databaseUrl).toContain('postgres://');
    expect(e.encryptionKey).toBe(KEY);
    expect(e.isProduction).toBe(true);
  });

  it('treats blank as unset, so an empty variable does not look configured', () => {
    const e = readEnvironment(env({ APP_ENCRYPTION_KEY: '   ' }));
    expect(e.encryptionKey).toBeNull();
  });

  it('trims surrounding whitespace, a common paste error', () => {
    expect(readEnvironment(env({ APP_ENCRYPTION_KEY: `  ${KEY}  ` })).encryptionKey).toBe(KEY);
  });
});

describe('checkConfiguration', () => {
  it('passes a correct production setup', () => {
    expect(checkConfiguration(readEnvironment(env()))).toEqual([]);
  });

  it('objects to production with no database, naming the consequence', () => {
    const problems = checkConfiguration(readEnvironment(env({ DATABASE_URL: '' })));
    expect(problems).toHaveLength(1);
    expect(problems[0]?.problem).toContain('lost on restart');
    expect(problems[0]?.fix).toContain('postgres://');
  });

  it('allows development with no database', () => {
    const problems = checkConfiguration(
      readEnvironment(env({ NODE_ENV: 'development', DATABASE_URL: '' })),
    );
    expect(problems).toEqual([]);
  });

  it('requires an encryption key in every environment', () => {
    const problems = checkConfiguration(
      readEnvironment(env({ NODE_ENV: 'development', DATABASE_URL: '', APP_ENCRYPTION_KEY: '' })),
    );
    expect(problems[0]?.variable).toBe('APP_ENCRYPTION_KEY');
    expect(problems[0]?.fix).toContain('openssl rand -base64 32');
  });

  it('rejects an encryption key of the wrong length rather than padding it', () => {
    const short = Buffer.alloc(16, 1).toString('base64');
    const problems = checkConfiguration(readEnvironment(env({ APP_ENCRYPTION_KEY: short })));
    expect(problems[0]?.problem).toContain('16 bytes');
  });

  it('insists on SSL in production, since credentials cross the network', () => {
    const problems = checkConfiguration(
      readEnvironment(env({ DATABASE_URL: 'postgres://u:p@h/d' })),
    );
    expect(problems.some((p) => p.problem.includes('in the clear'))).toBe(true);
  });

  it('accepts ssl=true as well as sslmode=require', () => {
    expect(
      checkConfiguration(readEnvironment(env({ DATABASE_URL: 'postgres://u:p@h/d?ssl=true' }))),
    ).toEqual([]);
  });

  it('reports every problem at once rather than one per restart', () => {
    const problems = checkConfiguration(
      readEnvironment(env({ DATABASE_URL: '', APP_ENCRYPTION_KEY: '' })),
    );
    expect(problems.map((p) => p.variable).toSorted()).toEqual(['APP_ENCRYPTION_KEY', 'DATABASE_URL']);
  });

  it('gives every problem an actionable fix', () => {
    const problems = checkConfiguration(
      readEnvironment(env({ DATABASE_URL: 'postgres://u:p@h/d', APP_ENCRYPTION_KEY: 'nope' })),
    );
    expect(problems.length).toBeGreaterThan(0);
    for (const problem of problems) expect(problem.fix.length).toBeGreaterThan(10);
  });
});
