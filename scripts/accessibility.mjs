/**
 * Accessibility sweep, with axe, across every screen in the product.
 *
 * Signed out, as a customer with data, and as an operator in the console —
 * eighteen screens, against WCAG 2.0/2.1/2.2 A and AA.
 *
 * Needs a dev server and a browser, so it is NOT part of `npm test`: that
 * suite runs without either, and a test that silently skips is worse than one
 * somebody actually runs.
 *
 *     npm run dev
 *     npm run accessibility
 *
 * Exits non-zero when anything violates, so it can be a CI step wherever a
 * browser is available.
 */
/* One browser page walks the screens in order, so the awaits below are meant
   to be sequential — auditing in parallel would need a page each and tell us
   nothing more. `scripts/**` turns off no-await-in-loop for that reason. */
// Playwright is not an app dependency; this resolves whatever the machine
// running the sweep has installed.
import pw from 'playwright';
import { readFileSync } from 'node:fs';
const { chromium } = pw;
const B = process.env.BASE_URL ?? 'http://localhost:3000';
const AXE = readFileSync(
  new URL('../node_modules/axe-core/axe.min.js', import.meta.url),
  'utf8',
);
// Only used to claim a console on a fresh database; ignored once claimed.
const SECRET = process.env.ADMIN_CLAIM_SECRET ?? '';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

const audit = async (p, label) => {
  await p.addScriptTag({ content: AXE });
  const r = await p.evaluate(async () => await window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  }));
  const out = r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length,
    help: v.help, sample: v.nodes[0]?.target?.join(' ') ?? '', snippet: (v.nodes[0]?.html ?? '').slice(0, 90) }));
  return { label, url: p.url(), violations: out };
};

const results = [];
const errs = [];

// --- signed-out ---
const anon = await b.newContext({ viewport: { width: 1280, height: 900 } });
const a = await anon.newPage();
a.on('pageerror', (e) => errs.push(`${a.url()} ${e}`));
for (const [path, label] of [['/', 'landing'], ['/sign-in', 'sign-in'], ['/sign-up', 'sign-up'], ['/admin/sign-in', 'admin sign-in']]) {
  await a.goto(`${B}${path}`, { waitUntil: 'networkidle' });
  results.push(await audit(a, label));
}
await anon.close();

// --- a customer with the demo data ---
const tc = await b.newContext({ viewport: { width: 1280, height: 900 } });
const t = await tc.newPage();
t.on('pageerror', (e) => errs.push(`${t.url()} ${e}`));
await t.goto(`${B}/sign-up`, { waitUntil: 'networkidle' });
await t.fill('#email', `a11y${Date.now()}@example.org`);
await t.fill('#password', 'a brand new passphrase');
await t.click('button[type=submit]');
await t.waitForURL(/onboarding/, { timeout: 60000 });
results.push(await audit(t, 'onboarding (new)'));
await t.fill('#legalName', 'Harbour Lights CIC');
await t.selectOption('#legalForm', { index: 1 });
await t.selectOption('#jurisdiction', { index: 1 });
await t.locator('form:has(#legalName) button[type=submit]').click();
await t.waitForTimeout(3500);
await t.goto(`${B}/onboarding#project`, { waitUntil: 'networkidle' });
await t.fill('#projectName', 'Harbour Skills Programme');
await t.fill('#amountSoughtGbp', '18000');
await t.fill('#durationMonths', '12');
await t.locator('form:has(#projectName) button[type=submit]').click();
await t.waitForTimeout(3500);

for (const [path, label] of [['/', 'home'], ['/funders', 'funders'], ['/tracker', 'tracker'],
  ['/applications', 'applications'], ['/organisation', 'organisation'], ['/documents', 'documents'],
  ['/opportunities/add', 'add a fund']]) {
  await t.goto(`${B}${path}`, { waitUntil: 'networkidle' });
  await t.waitForTimeout(500);
  results.push(await audit(t, label));
}
// One opportunity detail page.
const opp = await t.evaluate(() => document.querySelector('a[href^="/opportunities/opp"]')?.getAttribute('href'));
if (opp) { await t.goto(`${B}${opp}`, { waitUntil: 'networkidle' }); results.push(await audit(t, 'opportunity')); }
await tc.close();

// --- the console ---
const ac = await b.newContext({ viewport: { width: 1280, height: 900 } });
const q = await ac.newPage();
q.on('pageerror', (e) => errs.push(`${q.url()} ${e}`));
await q.goto(`${B}/admin/sign-in`, { waitUntil: 'networkidle' });
const claiming = await q.evaluate(() => document.body.textContent?.includes('Claim the console') ?? false);
await q.fill('#email', 'ops@example.org');
if (claiming) await q.fill('#secret', SECRET);
await q.fill('#password', 'a long enough passphrase here');
await q.click('form button[type=submit]');
await q.waitForURL(/\/admin$/, { timeout: 60000 });
for (const [path, label] of [['/admin', 'console overview'], ['/admin/funders', 'console funders'],
  ['/admin/catalogue', 'console catalogue'], ['/admin/accounts', 'console accounts'],
  ['/admin/admins', 'console admins'], ['/admin/settings', 'console services']]) {
  await q.goto(`${B}${path}`, { waitUntil: 'networkidle' });
  results.push(await audit(q, label));
}
await b.close();

let total = 0;
for (const r of results) {
  const n = r.violations.reduce((s, v) => s + v.n, 0);
  total += n;
  console.log(`${r.label.padEnd(22)} ${n === 0 ? 'clean' : `${n} node(s)`}`);
  for (const v of r.violations) console.log(`    [${v.impact}] ${v.id} ×${v.n} — ${v.help}\n      ${v.sample}\n      ${v.snippet}`);
}
console.log(`\nTOTAL violating nodes: ${total}`);
console.log('PAGE ERRORS:', errs.length); for (const e of errs.slice(0,5)) console.log('  ', e);
process.exit(total === 0 && errs.length === 0 ? 0 : 1);
