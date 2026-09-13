/**
 * Whether a URL somebody typed is safe for the server to fetch.
 *
 * ## The attack this exists to stop
 *
 * "Give us your website and we will read it" means a person hands us an
 * address and the SERVER makes the request. That is server-side request
 * forgery, and the server's network position is the prize: it can reach a
 * cloud provider's metadata endpoint, a database on a private subnet, an
 * internal admin panel — all places the person could never reach themselves.
 * The reply need not even come back; a timing difference is enough to map a
 * network.
 *
 * So the rule is a WHITELIST of shapes, not a blacklist of known-bad
 * addresses. A blacklist has to think of `0177.0.0.1`, `2130706433`,
 * `[::ffff:127.0.0.1]`, `localtest.me`, and whatever encoding is discovered
 * next. A whitelist only has to be right about what a community
 * organisation's website looks like: https, a public hostname with a dot in
 * it, no credentials, the default port.
 *
 * Pure, because this is the part that must be provably right and the part a
 * network call cannot be trusted to enforce. The fetcher applies it again to
 * every RESOLVED address and every redirect, because a name that passes here
 * can still resolve into a private range — see `isPrivateAddress`.
 */

export type AddressRefusal =
  | 'not-a-url'
  | 'not-https'
  | 'has-credentials'
  | 'odd-port'
  | 'not-public';

export interface AddressCheck {
  ok: boolean;
  /** Normalised, with the fragment dropped. Only set when ok. */
  url: string | null;
  reason: AddressRefusal | null;
  /** What to tell the person, in terms of their own website. */
  message: string | null;
}

const MESSAGES: Record<AddressRefusal, string> = {
  'not-a-url': 'That does not look like a web address. It should start with https:// .',
  'not-https':
    'We only read addresses beginning https:// . An http:// page can be altered in transit, and we are about to turn what it says into facts about you.',
  'has-credentials':
    'Take the username and password out of the address — we will not send credentials to a website.',
  'odd-port':
    'We only read a website on its normal address, without a port number after the host.',
  'not-public':
    'That address is not a public website. Give us the address you would give a funder.',
};

/**
 * Host names that are never somebody's website.
 *
 * A COURTESY, not the control. Writing this, `localhost.localdomain` — the
 * traditional loopback FQDN on Linux — walked straight through it: it has a
 * dot and none of the reserved suffixes. That is the blacklist problem showing
 * up inside the very function whose comment warns about it, and it is exactly
 * why the real defence is `isPrivateAddress` applied to what DNS RESOLVED, on
 * the original request and again on every redirect.
 *
 * So this exists to say something useful to somebody who mistyped, and to keep
 * obvious probes out of the resolver. It is not what stops the attack.
 */
function isPublicHostname(host: string): boolean {
  const name = host.toLowerCase();
  if (name === '' || !name.includes('.')) return false;
  if (name.endsWith('.')) return false;
  // The leftmost label, so `localhost.anything` goes too — not just the
  // suffixes somebody thought to list.
  if (name.split('.')[0] === 'localhost') return false;
  for (const suffix of ['.localhost', '.localdomain', '.local', '.internal', '.home.arpa', '.arpa']) {
    if (name.endsWith(suffix)) return false;
  }
  // An IP literal is never how a website is given out, and every literal
  // shape is a way of writing a private address that a name check would miss.
  if (/^[0-9.]+$/u.test(name)) return false;
  if (name.startsWith('[') || name.includes(':')) return false;
  return true;
}

/**
 * Is this resolved address inside a range the internet does not route?
 *
 * Applied to what DNS actually returned, which is the only way to catch a
 * public name pointing at a private host — deliberately, as an attack, or by
 * accident on a split-horizon network.
 */
export function isPrivateAddress(address: string): boolean {
  const ip = address.trim().toLowerCase();

  // IPv6, including the forms that carry an IPv4 address inside them.
  if (ip.includes(':')) {
    const bare = ip.replaceAll(/^\[|\]$/gu, '');
    if (bare === '::' || bare === '::1') return true;
    // Link-local, unique-local, and IPv4-mapped.
    if (/^fe[89ab]/u.test(bare)) return true;
    if (/^f[cd]/u.test(bare)) return true;
    const mapped = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/u.exec(bare);
    if (mapped?.[1] !== undefined) return isPrivateAddress(mapped[1]);
    return false;
  }

  const parts = ip.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a = 0, b = 0] = parts;

  if (a === 0) return true; // this network
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, and cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast and reserved
  return false;
}

const refuse = (reason: AddressRefusal): AddressCheck => ({
  ok: false,
  url: null,
  reason,
  message: MESSAGES[reason],
});

/** Check an address a person typed, before anything is fetched. */
export function checkWebAddress(raw: string): AddressCheck {
  const trimmed = raw.trim();
  if (trimmed === '') return refuse('not-a-url');

  let url: URL;
  try {
    // A bare domain is what people type, so give it the scheme we require
    // rather than refusing on a technicality. Anything with a DIFFERENT
    // scheme already present still has to survive the https check below.
    url = new URL(/^[a-z][a-z0-9+.-]*:/iu.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return refuse('not-a-url');
  }

  if (url.protocol !== 'https:') return refuse('not-https');
  if (url.username !== '' || url.password !== '') return refuse('has-credentials');
  if (url.port !== '' && url.port !== '443') return refuse('odd-port');
  if (!isPublicHostname(url.hostname)) return refuse('not-public');

  // The fragment never reaches a server, so keeping it would only make two
  // records of the same page look like two pages.
  url.hash = '';
  return { ok: true, url: url.toString(), reason: null, message: null };
}
