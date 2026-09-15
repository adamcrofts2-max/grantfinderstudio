/**
 * Walk the product as a new CIC would, and say what each screen offers.
 *
 * Not an assertion harness — a reading. It completes setup the way somebody
 * who is not on the Companies House register would, then follows every screen
 * and records what is actually in front of a person, at phone width.
 */
import { chromium } from 'playwright';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';

function cp() {
  const root = '/opt/pw-browsers';
  for (const n of readdirSync(root).filter((x) => /^chromium-\\d+$/.test(x)).toSorted().toReversed()) {
    const c = `${root}/${n}/chrome-linux/chrome`;
    if (existsSync(c)) return c;
  }
  return undefined;
}

const OUT = '/tmp/claude-0/walk';
mkdirSync(OUT, { recursive: true });
const B = 'http://127.0.0.1:3000';
const browser = await chromium.launch({ executablePath: cp() });
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`client exception: ${e.message.slice(0, 140)}`));

const look = async (label, file, chars = 900) => {
  const text = (await page.locator('body').innerText()).replace(/\\s+/gu, ' ');
  await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  const url = new URL(page.url());
  console.log(`\\n=== ${label}  ->  ${url.pathname}${url.search}`);
  if (overflow > 0) console.log(`  !! overflows sideways by ${overflow}px`);
  if (/Application error|server-side exception/i.test(text)) console.log('  !! SERVER ERROR');
  // Strip the shell so the page's own content is what shows.
  console.log(`  ${text.replace(/^.*?All sections /u, '').slice(0, chars)}`);
};

const password = 'a-long-enough-passphrase-9';
await page.goto(`${B}/sign-up`, { waitUntil: 'domcontentloaded' });
await page.fill('input[type="email"]', `walk-${Date.now()}@example.org`);
for (const f of await page.locator('input[type="password"]').all()) await f.fill(password);
await page.click('button[type="submit"]');
await page.waitForLoadState('networkidle');

// --- step 1: who we are, the self-declared way ---------------------------
await page.goto(`${B}/onboarding`, { waitUntil: 'networkidle' });
const own = page.locator('summary', { hasText: /Enter your details yourself|Can.t find it/i }).first();
if (await own.count()) await own.click();
await page.fill('input[name="legalName"]', 'Rivermead Community Interest Company');
await page.selectOption('select[name="legalForm"]', { index: 1 });
await page.selectOption('select[name="jurisdiction"]', { index: 1 });
await page.fill('input[name="region"]', 'Somerset');
await page.fill('input[name="incorporationDate"]', '2021-04-06');
await page.locator('form', { has: page.locator('input[name="legalName"]') }).locator('button[type="submit"]').click();
await page.waitForLoadState('networkidle');
await look('after saying who we are', '02-after-profile');

// --- step 2: what we are trying to fund ----------------------------------
await page.goto(`${B}/onboarding`, { waitUntil: 'networkidle' });
if (await page.locator('input[name="projectName"]').count()) {
  await page.fill('input[name="projectName"]', 'Riverside youth skills');
  await page.fill('textarea[name="description"]', 'Practical training and volunteering for 14-19 year olds in Wells.');
  await page.fill('input[name="amountSoughtGbp"]', '18000');
  await page.fill('input[name="durationMonths"]', '12');
  const boxes = await page.locator('input[name="beneficiaries"]').all();
  if (boxes.length > 0) await boxes[0].check();
  await page.locator('form', { has: page.locator('input[name="projectName"]') }).locator('button[type="submit"]').click();
  await page.waitForLoadState('networkidle');
  await look('after saying what we need', '03-after-project');
} else {
  console.log('\\n!! no project form on /onboarding after the profile was saved');
}

for (const [label, path] of [
  ['home, once set up', '/'],
  ['organisation / facts', '/organisation'],
  ['grants, with a profile', '/grants'],
  ['funders', '/funders'],
  ['add a fund', '/opportunities/add'],
  ['tracker', '/tracker'],
  ['applications', '/applications'],
  ['documents', '/documents'],
]) {
  await page.goto(`${B}${path}`, { waitUntil: 'networkidle' });
  await look(label, (path.replace(/[^a-z]+/gu, '-').replace(/^-|-$/gu, '') || 'home') + '-set-up');
}

if (problems.length > 0) console.log('\\nPROBLEMS:', problems.join(' | '));
await browser.close();
