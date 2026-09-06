import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  loadMasterKey,
  maskSecret,
  SecretError,
  secretsMatch,
} from './crypto.js';

const KEY = randomBytes(32);
const KEY_B64 = KEY.toString('base64');
const API_KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';

describe('loadMasterKey', () => {
  it('accepts 32 bytes of base64', () => {
    expect(loadMasterKey(KEY_B64)).toHaveLength(32);
  });

  it('refuses to run without a key, and says how to make one', () => {
    expect(() => loadMasterKey(undefined)).toThrow(/openssl rand -base64 32/);
    expect(() => loadMasterKey('  ')).toThrow(SecretError);
  });

  it('rejects a key of the wrong length rather than padding it', () => {
    const short = randomBytes(16).toString('base64');
    expect(() => loadMasterKey(short)).toThrow(/must decode to 32 bytes, got 16/);
  });
});

describe('encrypt and decrypt', () => {
  it('round-trips a secret', () => {
    expect(decryptSecret(encryptSecret(API_KEY, KEY), KEY)).toBe(API_KEY);
  });

  it('never puts the plaintext in the stored value', () => {
    const stored = encryptSecret(API_KEY, KEY);
    expect(stored).not.toContain(API_KEY);
    expect(stored).not.toContain('sk-ant');
  });

  it('produces a different ciphertext each time, so repeats are not detectable', () => {
    const a = encryptSecret(API_KEY, KEY);
    const b = encryptSecret(API_KEY, KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe(decryptSecret(b, KEY));
  });

  it('round-trips unicode and long values', () => {
    const awkward = '🔑 clé — ' + 'x'.repeat(5000);
    expect(decryptSecret(encryptSecret(awkward, KEY), KEY)).toBe(awkward);
  });

  it('refuses to encrypt nothing', () => {
    expect(() => encryptSecret('', KEY)).toThrow(SecretError);
  });

  it('fails rather than returning altered plaintext when tampered with', () => {
    const stored = encryptSecret(API_KEY, KEY);
    const parts = stored.split('.');
    const flipped = Buffer.from(parts[3]!, 'base64');
    flipped.writeUInt8(flipped.readUInt8(0) ^ 0xff, 0);
    parts[3] = flipped.toString('base64');
    expect(() => decryptSecret(parts.join('.'), KEY)).toThrow(SecretError);
  });

  it('fails when the authentication tag is altered', () => {
    const parts = encryptSecret(API_KEY, KEY).split('.');
    parts[2] = randomBytes(16).toString('base64');
    expect(() => decryptSecret(parts.join('.'), KEY)).toThrow(SecretError);
  });

  it('fails with the wrong master key', () => {
    const stored = encryptSecret(API_KEY, KEY);
    expect(() => decryptSecret(stored, randomBytes(32))).toThrow(SecretError);
  });

  it('does not reveal whether the key or the payload was wrong', () => {
    const stored = encryptSecret(API_KEY, KEY);
    const wrongKey = (() => {
      try { decryptSecret(stored, randomBytes(32)); } catch (e) { return (e as Error).message; }
      return '';
    })();
    const parts = stored.split('.');
    parts[2] = randomBytes(16).toString('base64');
    const tampered = (() => {
      try { decryptSecret(parts.join('.'), KEY); } catch (e) { return (e as Error).message; }
      return '';
    })();
    expect(wrongKey).toBe(tampered);
  });

  it.each([
    ['empty', ''],
    ['not versioned', 'abc.def.ghi.jkl'],
    ['too few parts', 'v1.aaa.bbb'],
    ['a bare string', 'sk-ant-plaintext'],
  ])('rejects a stored value that is %s', (_label, payload) => {
    expect(() => decryptSecret(payload, KEY)).toThrow(SecretError);
  });

  it('rejects a malformed initialisation vector', () => {
    const parts = encryptSecret(API_KEY, KEY).split('.');
    parts[1] = randomBytes(4).toString('base64');
    expect(() => decryptSecret(parts.join('.'), KEY)).toThrow(/malformed/);
  });
});

describe('maskSecret', () => {
  it('shows enough to tell two keys apart and no more', () => {
    const masked = maskSecret(API_KEY);
    expect(masked).toBe('sk-ant-…6789');
    expect(masked).not.toContain('abcdefg');
  });

  it('masks a short value entirely', () => {
    expect(maskSecret('short')).toBe('••••••••');
    expect(maskSecret('123456789012')).toBe('••••••••');
  });

  it('never returns the whole secret', () => {
    for (const value of [API_KEY, 'a'.repeat(200), 'sk-ant-1234567890']) {
      expect(maskSecret(value)).not.toBe(value);
    }
  });
});

describe('secretsMatch', () => {
  it('matches identical values', () => {
    expect(secretsMatch('abc123', 'abc123')).toBe(true);
  });

  it('rejects different values and different lengths', () => {
    expect(secretsMatch('abc123', 'abc124')).toBe(false);
    expect(secretsMatch('abc', 'abcd')).toBe(false);
  });
});
