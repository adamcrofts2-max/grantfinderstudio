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

/**
 * Open whatever panel HOLDS this field, and wait until it can be typed in.
 *
 * Two mistakes kept recurring, and both are fixed here once rather than at
 * each call site:
 *
 *  - Matching a `<summary>` by its wording breaks the moment anything else on
 *    the page changes. Ask for the `<details>` containing the field.
 *  - `networkidle` is not "the server action finished". A form can be in the
 *    DOM and collapsed because the page still thinks the previous step is the
 *    current one, so this RELOADS and re-checks rather than waiting on the
 *    network.
 */
async function reachField(name, { reload = `${B}/onboarding`, tries = 12 } = {}) {
  const field = page.locator(`[name="${name}"]`).first();
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if ((await field.count()) > 0) {
      if (await field.isVisible()) return true;
      const holder = page
        .locator('details', { has: page.locator(`[name="${name}"]`) })
        .locator('summary')
        .first();
      if ((await holder.count()) > 0) {
        await holder.click();
        if (await field.isVisible()) return true;
      }
    }
    if (reload === null) return false;
    await page.waitForTimeout(1000);
    await page.goto(reload, { waitUntil: 'networkidle' });
  }
  return false;
}

/**
 * Refuse to walk a product whose database is not there.
 *
 * Postgres dying mid-run produced a walk that read as though the product had
 * signed the user out — which is the app failing CLOSED, correctly, and
 * completely unreadable as a report. Better to say what is actually wrong.
 */
const health = await (await fetch(`${B}/api/health`)).json().catch(() => ({}));
if (health.database !== 'ok') {
  console.error(`The database is ${health.database ?? 'unreachable'} — start Postgres first.`);
  await browser.close();
  process.exit(1);
}

const password = 'a-long-enough-passphrase-9';
await page.goto(`${B}/sign-up`, { waitUntil: 'domcontentloaded' });
await page.fill('input[type="email"]', `walk-${Date.now()}@example.org`);
for (const f of await page.locator('input[type="password"]').all()) await f.fill(password);
await page.click('button[type="submit"]');
await page.waitForLoadState('networkidle');

// --- step 1: who we are, the self-declared way ---------------------------
await page.goto(`${B}/onboarding`, { waitUntil: 'networkidle' });
if (!(await reachField('legalName'))) {
  console.log('\n!! could not reach the self-declared profile form');
}
await page.fill('input[name="legalName"]', 'Rivermead Community Interest Company');
await page.selectOption('select[name="legalForm"]', { index: 1 });
await page.selectOption('select[name="jurisdiction"]', { index: 1 });
await page.fill('input[name="region"]', 'Somerset');
await page.fill('input[name="incorporationDate"]', '2021-04-06');
await page.locator('form', { has: page.locator('input[name="legalName"]') }).locator('button[type="submit"]').click();
await page.waitForLoadState('networkidle');
await look('after saying who we are', '02-after-profile');

// --- step 2: what we are trying to fund ----------------------------------
if (!(await reachField('projectName'))) {
  console.log('\n!! never reached the project form after saving the profile');
} else {
  await page.fill('input[name="projectName"]', 'Riverside youth skills');
  await page.fill('textarea[name="description"]', 'Practical training and volunteering for 14-19 year olds in Wells.');
  await page.fill('input[name="amountSoughtGbp"]', '18000');
  await page.fill('input[name="durationMonths"]', '12');
  const boxes = await page.locator('input[name="beneficiaries"]').all();
  if (boxes.length > 0) await boxes[0].check();
  await page.locator('form', { has: page.locator('input[name="projectName"]') }).locator('button[type="submit"]').click();
  await page.waitForLoadState('networkidle');
  await look('after saying what we need', '03-after-project');
}

// --- the half the product exists FOR: fund -> eligibility -> application ---
//
// Discovery has been walked and polished. This half has never been exercised
// end to end, and it is where the value is: write the application.
await page.goto(`${B}/opportunities/add`, { waitUntil: 'networkidle' });
if (await reachField('funderName', { reload: `${B}/opportunities/add` })) {
  await page.fill('input[name="funderName"]', 'The Wells Trust');
  await page.fill('input[name="title"]', 'Small Grants Programme');
  await page.fill('input[name="minAmountGbp"]', '5000');
  await page.fill('input[name="maxAmountGbp"]', '25000');
  // A published date and the kind that matches it. The first version of this
  // walk picked "rolling" AND typed a date — which the product accepted, and
  // the tracker then showed "Tue, 1 Dec 2026" beside "No deadline" on one row.
  // That is now refused, so the walk asks for something coherent.
  const kind = page.locator('select[name="deadlineKind"]');
  if (await kind.count()) await kind.selectOption('confirmed');
  const deadline = page.locator('input[name="deadline"]');
  if (await deadline.count()) await deadline.fill('2026-12-01');
  await page.locator('form', { has: page.locator('input[name="funderName"]') })
    .locator('button[type="submit"]').click();

  let landed = '';
  for (let i = 0; i < 12 && !/opportunities\/(?!add)/u.test(landed); i += 1) {
    await page.waitForTimeout(1000);
    landed = new URL(page.url()).pathname;
  }
  await look('after adding a fund by hand', '04-fund-added', 1400);
} else {
  console.log('\\n!! no manual fund form found on /opportunities/add');
}

// --- and the Writer, which is the point of the whole thing ---------------
//
// Never exercised end to end before: the agents had unit tests holding a fake
// provider object, and the real SDK call, wire format, parse and rendering
// were covered by nothing but production. With a stub Anthropic behind
// ANTHROPIC_BASE_URL, the only untested step left is whether the prose is any
// good — which only the real model can answer.
await page.goto(`${B}/tracker`, { waitUntil: 'networkidle' });
// Not `a[href^="/opportunities/"]`, which matched the hidden nav link to
// /opportunities/add — visible: false, and thirty seconds of retries.
const toFund = page
  .locator('main a[href^="/opportunities/"]:not([href="/opportunities/add"])')
  .first();
if (await toFund.count()) {
  await toFund.click();
  await page.waitForLoadState('networkidle');
  await look('the fund, as the product sees it', '05-opportunity', 1600);

  const start = page.getByRole('button', { name: /Start an application/iu }).first();
  if (!(await start.count())) {
    console.log('\\n!! no way to start an application from the fund');
  } else {
    await start.click();
    let appPath = '';
    for (let i = 0; i < 12 && !appPath.startsWith('/applications/'); i += 1) {
      await page.waitForTimeout(1000);
      appPath = new URL(page.url()).pathname;
    }
    await look('a new application', '06-application', 1200);

    const paste = page.locator('textarea').first();
    if (await paste.count()) {
      await paste.fill(
        [
          'Tell us about your organisation and what it does. (200 words)',
          '',
          'What will the money pay for, and who will benefit? (300 words)',
        ].join('\n'),
      );
      await page.waitForTimeout(600);
      const addThem = page.getByRole('button', { name: /question/iu }).first();
      if (await addThem.count()) {
        await addThem.click();
        for (let i = 0; i < 12; i += 1) {
          await page.waitForTimeout(1000);
          if (await page.getByRole('button', { name: /Draft from my facts|Draft again/iu }).count()) break;
        }
        await look('questions pasted in', '07-questions', 1200);

        const draft = page.getByRole('button', { name: /Draft from my facts|Draft again/iu }).first();
        if (!(await draft.count())) {
          console.log('\\n!! the questions went in but there is no way to draft');
        } else {
          await draft.click();
          for (let i = 0; i < 25; i += 1) {
            await page.waitForTimeout(1000);
            const body = await page.locator('body').innerText();
            if (/\\[stub\\]|needs an Anthropic|could not/iu.test(body)) break;
          }
          await look('after asking it to draft', '08-drafted', 2000);
        }
      } else {
        console.log('\\n!! pasted questions but found no button to accept them');
      }
    } else {
      console.log('\\n!! no box to paste the questions into');
    }
  }
} else {
  console.log('\\n!! the tracker offers no link through to the fund');
}

for (const [label, path] of [
  ['tracker, with a fund', '/tracker'],
  ['applications', '/applications'],
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
