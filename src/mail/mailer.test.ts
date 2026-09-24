import { describe, expect, it } from 'vitest';

import { readEnvironment } from '../env.js';
import { logMailer, mailSetup, resendMailer } from './mailer.js';

const MAIL = { to: 'someone@example.org', subject: 'Hello', text: 'A link' };

describe('the Resend mailer', () => {
  it('posts the message to /emails with the key as a bearer token', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fake = (async (url: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response('{"id":"e1"}', { status: 200 });
    }) as typeof fetch;

    await resendMailer('re_key', 'Studio <noreply@example.org>', 'http://127.0.0.1:4700', fake).send(MAIL);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://127.0.0.1:4700/emails');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Bearer re_key');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      from: 'Studio <noreply@example.org>',
      to: ['someone@example.org'],
      subject: 'Hello',
      text: 'A link',
    });
  });

  it('throws when Resend refuses, without the key in the message', async () => {
    const fake = (async () => new Response('domain not verified', { status: 403 })) as typeof fetch;
    const sending = resendMailer('re_secret', 'x@example.org', undefined, fake).send(MAIL);
    await expect(sending).rejects.toThrow(/403 domain not verified/u);
    await expect(sending).rejects.not.toThrow(/re_secret/u);
  });
});

describe('choosing a mailer', () => {
  it('uses Resend when all three settings are there', () => {
    const setup = mailSetup(
      readEnvironment({
        NODE_ENV: 'production',
        RESEND_API_KEY: 're_1',
        MAIL_FROM: 'x@example.org',
        APP_URL: 'https://grants.example.org',
      }),
    );
    expect(setup?.mailer.kind).toBe('resend');
    expect(setup?.linkBase.origin).toBe('https://grants.example.org');
  });

  it('has none in production without them, rather than one that sends nothing', () => {
    expect(mailSetup(readEnvironment({ NODE_ENV: 'production' }))).toBeNull();
    expect(
      mailSetup(readEnvironment({ NODE_ENV: 'production', RESEND_API_KEY: 're_1', MAIL_FROM: 'x@example.org' })),
    ).toBeNull();
  });

  it('prints to the log in development', async () => {
    const setup = mailSetup(readEnvironment({ NODE_ENV: 'development' }));
    expect(setup?.mailer.kind).toBe('log');
    expect(setup?.linkBase.origin).toBe('http://localhost:3000');

    const lines: string[] = [];
    await logMailer((line) => lines.push(line)).send(MAIL);
    expect(lines.join('\n')).toContain('A link');
  });
});
