/**
 * The address check, tested as the security control it is.
 *
 * "Give us your website and we will read it" hands an attacker the server's
 * network position. These cases are the ones a blacklist gets wrong, which is
 * why the rule is a whitelist of shapes instead.
 */

import { describe, expect, it } from 'vitest';

import { checkWebAddress, isPrivateAddress } from './address.js';

describe('an address somebody would actually give a funder', () => {
  it('accepts a plain https website', () => {
    const check = checkWebAddress('https://rivermead.org.uk/about');
    expect(check.ok).toBe(true);
    expect(check.url).toBe('https://rivermead.org.uk/about');
  });

  it('accepts what people really type, without a scheme', () => {
    expect(checkWebAddress('rivermead.org.uk').url).toBe('https://rivermead.org.uk/');
  });

  it('drops the fragment, which never reaches a server anyway', () => {
    // Keeping it would make two records of one page look like two pages.
    expect(checkWebAddress('https://rivermead.org.uk/about#team').url).toBe(
      'https://rivermead.org.uk/about',
    );
  });

  it('accepts an explicit :443', () => {
    expect(checkWebAddress('https://rivermead.org.uk:443/').ok).toBe(true);
  });
});

const refused = (raw: string) => checkWebAddress(raw);

describe('refusing what is not a website', () => {
  it('refuses http, because we are about to turn the page into facts', () => {
    expect(refused('http://rivermead.org.uk').reason).toBe('not-https');
  });

  it('refuses every other scheme', () => {
    for (const raw of ['file:///etc/passwd', 'ftp://host.example/', 'gopher://x.example/']) {
      expect(refused(raw).reason, raw).toBe('not-https');
    }
  });

  it('refuses credentials in the address', () => {
    // We must never send a username and password to a website.
    expect(refused('https://user:pw@rivermead.org.uk/').reason).toBe('has-credentials');
  });

  it('refuses a port, which is how an internal service gets probed', () => {
    for (const raw of ['https://rivermead.org.uk:8080/', 'https://rivermead.org.uk:5432/']) {
      expect(refused(raw).reason, raw).toBe('odd-port');
    }
  });

  it('refuses localhost in every dress', () => {
    for (const raw of [
      'https://localhost/',
      'https://localhost.localdomain/',
      'https://api.localhost/',
      'https://thing.local/',
      'https://admin.internal/',
      'https://x.home.arpa/',
      // The one that got through on the first attempt: the traditional
      // loopback FQDN on Linux. It has a dot and no reserved suffix.
      'https://localhost.localdomain/',
      'https://localhost.example.com/',
    ]) {
      expect(refused(raw).ok, raw).toBe(false);
    }
  });

  it('refuses a single-label host, which only resolves inside a network', () => {
    expect(refused('https://intranet/').reason).toBe('not-public');
  });

  it('refuses an IP literal however it is written', () => {
    // The whole point of the whitelist: a blacklist has to think of each of
    // these encodings, and the next one nobody has thought of yet.
    for (const raw of [
      'https://127.0.0.1/',
      'https://169.254.169.254/latest/meta-data/',
      'https://10.0.0.1/',
      'https://0177.0.0.1/',
      'https://2130706433/',
      'https://[::1]/',
      'https://[::ffff:127.0.0.1]/',
    ]) {
      expect(refused(raw).ok, raw).toBe(false);
    }
  });

  it('says something useful rather than just no', () => {
    expect(refused('http://rivermead.org.uk').message).toContain('altered in transit');
    expect(refused('https://10.0.0.1/').message).toContain('public website');
  });

  it('refuses nothing at all', () => {
    expect(refused('').reason).toBe('not-a-url');
    expect(refused('   ').reason).toBe('not-a-url');
  });
});

describe('checking what DNS actually returned', () => {
  it('catches the ranges the internet does not route', () => {
    for (const ip of [
      '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1',
      '169.254.169.254', '0.0.0.0', '100.64.0.1', '198.18.0.1', '224.0.0.1',
      '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:10.0.0.1',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('lets a real public address through', () => {
    for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('treats anything it cannot parse as private', () => {
    // Fails CLOSED. An address we do not understand is not one to connect to.
    for (const ip of ['', 'not-an-ip', '1.2.3', '1.2.3.4.5']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('catches a public NAME that resolves privately, which is the rebinding case', () => {
    // checkWebAddress passes the name; only this catches where it points.
    expect(checkWebAddress('https://localtest.me/').ok).toBe(true);
    expect(isPrivateAddress('127.0.0.1')).toBe(true);
  });
});
