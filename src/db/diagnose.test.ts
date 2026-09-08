import { describe, expect, it } from 'vitest';

import { diagnose } from './diagnose.js';

describe('diagnose', () => {
  it('names the fix for a channel-binding refusal', () => {
    const d = diagnose(new Error('SASL: channel binding is required'));
    expect(d.hint).toContain('channel_binding');
  });

  it('names the fix for a wrong password', () => {
    const e = Object.assign(new Error('password authentication failed for user "x"'), {
      code: '28P01',
    });
    expect(diagnose(e).hint).toContain('password');
    expect(diagnose(e).detail).toContain('28P01');
  });

  it('names the fix for a hostname that does not resolve', () => {
    const e = Object.assign(new Error('getaddrinfo ENOTFOUND db.example'), {
      code: 'ENOTFOUND',
    });
    // A connection string pasted with a line break in it is the usual cause.
    expect(diagnose(e).hint).toContain('line break');
  });

  it('names the fix when the role cannot be created', () => {
    expect(diagnose(new Error('permission denied to create role')).hint).toContain(
      'CREATE ROLE app_user',
    );
  });

  it('still reports the driver’s words when it recognises nothing', () => {
    const d = diagnose(new Error('something nobody has seen before'));
    expect(d.detail).toBe('something nobody has seen before');
    expect(d.hint).toBeNull();
  });

  it('survives being handed something that is not an error', () => {
    expect(diagnose(undefined).detail).toBeTypeOf('string');
    expect(diagnose('a string').detail).toBeTypeOf('string');
  });

  it('never repeats a connection string back', () => {
    // Driver errors describe the failure, not the credentials — but if one ever
    // did, this is where it would leak into an unauthenticated endpoint.
    const secret = 'postgresql://u:p@host/db';
    const d = diagnose(new Error(`could not connect to ${secret}`));
    expect(d.detail).not.toContain('://u:p@');
  });
});
