/**
 * Does /grants show loaded grants, in a production build, to a real user?
 *
 * A browser drives the real sign-up form, the corpus is loaded from a stub
 * 360Giving through the product's own admin route, and then /grants is read
 * the way a person reads it. Every fault this week lived in the gap between
 * "the code is shaped right" and "the running product agrees" — and a Next
 * server action cannot be posted to over raw HTTP, because its id is
 * build-specific. So: a browser.
 */
import { createServer } from 'node:http';
import { existsSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';

/**
 * Chromium, wherever this environment put it.
 *
 * Hardcoding the path cost a run: `PLAYWRIGHT_BROWSERS_PATH` holds versioned
 * directories (`chromium-1194`), not a stable `chromium`, so the obvious guess
 * does not exist. Playwright's own default is tried first and this only steps
 * in when the bundled browser is absent.
 */
function chromiumPath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  const versioned = readdirSync(root)
    .filter((name) => /^chromium-\d+$/u.test(name))
    .toSorted()
    .toReversed();
  for (const name of versioned) {
    const candidate = `${root}/${name}/chrome-linux/chrome`;
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

const B = 'http://127.0.0.1:3000';
const API_PORT = 4599;

const FUNDERS = ['GB-CHC-STUB-1', 'GB-CHC-STUB-2'];
const grant = (id, org) => ({
  grant_id: id,
  data: {
    id,
    title: 'Riverside youth skills programme',
    description: 'Practical training for young people in Somerset',
    currency: 'GBP',
    amountAwarded: 17500,
    awardDate: '2025-07-11',
    fundingOrganization: [{ id: org, name: `Stub Trust ${org.slice(-1)}` }],
    recipientOrganization: [{ id: 'GB-COH-9', name: 'Wells Youth Collective' }],
    beneficiaryLocation: [{ name: 'Somerset' }, { name: 'England' }],
    classifications: [{ title: 'Young people' }],
  },
  data_license: { url: 'https://creativecommons.org/licenses/by/4.0/', name: 'CC BY 4.0' },
  funders: [{ org_id: org }],
});

const api = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('content-type', 'application/json');
  if (url.pathname === '/api/v1/org/funder/') {
    const offset = Number(url.searchParams.get('offset') ?? '0');
    const limit = Number(url.searchParams.get('limit') ?? '50');
    res.end(JSON.stringify({
      count: FUNDERS.length,
      results: FUNDERS.slice(offset, offset + limit)
        .map((org_id) => ({ org_id, name: `Stub Trust ${org_id.slice(-1)}` })),
    }));
    return;
  }
  const m = /\/org\/([^/]+)\/grants_made\//.exec(url.pathname);
  if (m) {
    const org = decodeURIComponent(m[1]);
    res.end(JSON.stringify({ count: 1, next: null, results: [grant(`${org}-1`, org)] }));
    return;
  }
  res.statusCode = 404;
  res.end('{}');
});
await new Promise((r) => api.listen(API_PORT, '127.0.0.1', r));

const executablePath = chromiumPath();
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const ok = (m) => console.log('  ok —', m);

try {
  // --- the applicant --------------------------------------------------------
  const page = await browser.newPage();
  page.on('pageerror', (e) => fail(`client exception: ${e.message}`));

  const email = `e2e-${Date.now()}@example.org`;
  const password = 'a-long-enough-passphrase-9';

  await page.goto(`${B}/sign-up`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', email);
  for (const field of await page.locator('input[type="password"]').all()) {
    await field.fill(password);
  }
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
  const landed = new URL(page.url()).pathname;
  if (landed === '/sign-up') {
    fail(`sign-up did not go through — page says: ${(await page.locator('body').innerText()).replace(/\s+/gu, ' ').slice(0, 400)}`);
  } else ok(`signed up, landed on ${landed}`);

  // --- /grants fills the record BY ITSELF -----------------------------------
  //
  // The point of the whole feature, and the thing three rounds of copy
  // changes could not fix: an applicant must not be waiting on admin work.
  // No console, no button, no environment variable is touched before this.
  await page.goto(`${B}/grants`, { waitUntil: 'networkidle' });
  const firstVisit = await page.locator('body').innerText();
  if (/Application error|server-side exception/i.test(firstVisit)) {
    fail('/grants threw on a first visit');
  } else ok('/grants renders on a first visit');

  // Every message this replaced, and none of them may come back.
  if (/no grants have been loaded yet/i.test(firstVisit)) fail('still blames an operator');
  if (/has not been started here/i.test(firstVisit)) fail('still says nothing is happening');
  if (/start it under Funders/i.test(firstVisit)) fail('still asks somebody to press something');

  if (/building the grant record now/i.test(firstVisit)) {
    ok('the first visit says the record is being built');
  } else if (/grants held/i.test(firstVisit)) {
    ok('the record is already built, so the notice is gone');
  } else {
    fail(`neither building nor built: ${firstVisit.replace(/\s+/gu, ' ').slice(0, 300)}`);
  }

  // `after()` runs the step once the response is out, so give it a moment and
  // then read the progress endpoint — which is the only honest way to see that
  // a page view really did cause work.
  let progressed = false;
  for (let attempt = 0; attempt < 12 && !progressed; attempt += 1) {
    await page.waitForTimeout(2000);
    const body = await (await fetch(`${B}/api/corpus`)).json();
    progressed = Boolean(body.progress?.startedAt) && body.progress.fundersDone > 0;
    if (!progressed) await page.goto(`${B}/grants`, { waitUntil: 'networkidle' });
  }
  if (progressed) ok('a page visit alone started and advanced the record');
  else fail('a page visit did not cause the record to fill');

  // --- and searching finds what the visit loaded ---------------------------
  await page.goto(`${B}/grants?q=1&text=somerset`, { waitUntil: 'networkidle' });
  const selfLoaded = await page.locator('body').innerText();
  if (/Riverside youth skills programme/.test(selfLoaded)) {
    ok('the grant is searchable without anybody loading it');
  } else fail('the self-loaded grant is not searchable');

  // --- load the corpus, as an operator would -------------------------------
  const admin = await browser.newPage();
  admin.on('pageerror', (e) => fail(`admin client exception: ${e.message}`));
  await admin.goto(`${B}/admin/sign-in`, { waitUntil: 'domcontentloaded' });
  const secret = process.env.ADMIN_CLAIM_SECRET ?? '';
  if (secret === '') {
    fail('ADMIN_CLAIM_SECRET is not set, so the first admin cannot be claimed.');
  }
  await admin.fill('input[type="email"]', `admin-${Date.now()}@example.org`);
  await admin.fill('input[name="password"]', password);
  const secretField = admin.locator('input[name="secret"]');
  if (await secretField.count()) {
    await secretField.fill(secret);
  } else {
    // No claim field means an admin already exists on this deployment, and
    // this script does not know their password. Said plainly, because the
    // first version of it reported seven mystery failures instead.
    fail(
      'An admin already exists here, so the claim flow is gone and this check cannot sign in. ' +
        'Clear admin_accounts and admin_sessions on the test database first.',
    );
  }
  await admin.click('button[type="submit"]');
  await admin.waitForLoadState('networkidle');
  const adminLanded = new URL(admin.url()).pathname;
  if (adminLanded.startsWith('/admin/sign-in')) {
    fail(`admin sign-in did not go through: ${(await admin.locator('body').innerText()).replace(/\s+/gu, ' ').slice(0, 300)}`);
  } else ok(`admin landed on ${adminLanded}`);

  await admin.goto(`${B}/admin/funders`, { waitUntil: 'networkidle' });
  const panel = await admin.locator('body').innerText();
  if (!/grant record/i.test(panel)) fail('the corpus panel is not on /admin/funders');
  else ok('the corpus panel is there');
  // It must read as visibility, not as a job somebody has to do.
  if (!/runs itself/i.test(panel)) fail('the console does not say the load runs itself');
  else ok('the console says the load runs itself');
  if (/Start the walk/i.test(panel)) fail('the console still presents starting as a task');
  else ok('there is no "start the walk" task');

  const step = admin.getByRole('button', { name: /Run one step now/i });
  if (!(await step.count())) fail('no "Run one step now" button');
  else {
    await step.click();
    await admin.waitForLoadState('networkidle');
    await admin.waitForTimeout(3000);
    const after = await admin.locator('body').innerText();
    console.log('  step result:', (after.match(/\d+ funders? read[^.]*\./) ?? ['(none)'])[0]);
    if (/funders? read/.test(after)) ok('a step ran and reported');
    else fail('the step reported nothing');
  }

  // --- /grants with grants in it -------------------------------------------
  await page.goto(`${B}/grants?q=1&text=somerset`, { waitUntil: 'networkidle' });
  const loaded = await page.locator('body').innerText();
  if (/Application error|server-side exception/i.test(loaded)) fail('/grants threw after loading');
  if (!/Riverside youth skills programme/.test(loaded)) fail('the loaded grant is not on the page');
  else ok('the grant appears in the search');
  if (!/17,500|£17,500/.test(loaded)) fail('the amount is not shown');
  else ok('the amount is shown');
  if (!/Wells Youth Collective/.test(loaded)) fail('the recipient is not shown');
  else ok('the recipient is shown');
  if (!/Stub Trust/.test(loaded)) fail('the funder is not named');
  else ok('the funder is named');
  if (!/Add a fund from them/.test(loaded)) fail('no link through to adding a fund');
  else ok('the link through to a fund is there');

  // --- a search that matches nothing ---------------------------------------
  await page.goto(`${B}/grants?q=1&text=zzzznothing`, { waitUntil: 'networkidle' });
  const none = await page.locator('body').innerText();
  if (!/Nothing came back for that/.test(none)) fail('a no-match search does not say so');
  else ok('a no-match search says so');
} finally {
  await browser.close();
  api.close();
}

console.log(process.exitCode ? '\nE2E: FAILED' : '\nE2E: clean');
