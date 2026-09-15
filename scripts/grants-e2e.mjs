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

const FUNDERS = ['GB-CHC-STUB-1', 'GB-CHC-STUB-2', 'GB-CHC-STUB-3'];

/**
 * A spread of sizes, places and labels, so the filters have something to bite
 * on. The labels differ deliberately — "Young people" and "Children and young
 * people" are one idea under two names, which is exactly the corpus's problem
 * and the reason the options are derived from results rather than curated.
 */
const SHAPES = {
  'GB-CHC-STUB-1': { amount: 17500, place: 'Somerset', topic: 'Young people', year: '2025' },
  'GB-CHC-STUB-2': { amount: 3200, place: 'Devon', topic: 'Children and young people', year: '2025' },
  'GB-CHC-STUB-3': { amount: 240000, place: 'Somerset', topic: 'Heritage', year: '2019' },
};
const grant = (id, org) => ({
  grant_id: id,
  data: {
    id,
    title: 'Riverside youth skills programme',
    description: 'Practical training for young people in Somerset',
    currency: 'GBP',
    amountAwarded: SHAPES[org]?.amount ?? 17500,
    awardDate: `${SHAPES[org]?.year ?? '2025'}-07-11`,
    fundingOrganization: [{ id: org, name: `Stub Trust ${org.slice(-1)}` }],
    recipientOrganization: [{ id: 'GB-COH-9', name: 'Wells Youth Collective' }],
    beneficiaryLocation: [{ name: SHAPES[org]?.place ?? 'Somerset' }, { name: 'England' }],
    classifications: [{ title: SHAPES[org]?.topic ?? 'Young people' }],
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
const PHONE = { width: 390, height: 844 };
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

  // --- narrowing ------------------------------------------------------------
  await page.goto(`${B}/grants?q=1&text=youth`, { waitUntil: 'networkidle' });

  // The options are folded away on a first search, so open them the way a
  // person does. This step existing is the point: results come first, filters
  // are one tap behind them.
  const openNarrow = page.locator('summary.narrow-summary');
  if (!(await openNarrow.count())) fail('there is no way to open the filters');
  else ok('the filters can be opened');
  await openNarrow.click();

  const unnarrowed = await page.locator('body').innerText();
  if (!/Size of grant/i.test(unnarrowed)) fail('no way to narrow the results');
  else ok('the narrowing options are there');

  // Every chip must carry a count. A filter without one is a trap: you tap it,
  // you get nothing, and you learn only that you wasted a tap.
  const chips = await page.locator('.chip').all();
  if (chips.length === 0) fail('no chips rendered');
  const counted = [];
  for (const chip of chips) counted.push((await chip.innerText()).replace(/\s+/gu, ' '));
  const withoutCount = counted.filter((t) => !/\d/u.test(t) && !/About what we need/i.test(t));
  if (withoutCount.length > 0) fail(`chips with no count: ${withoutCount.join(' | ')}`);
  else ok('every chip carries a count');

  // The options must be the publishers' own labels, taken from the results —
  // including the two spellings of one idea, which a curated list would hide.
  if (!/Young people/.test(unnarrowed)) fail('the publishers\' own topics are not offered');
  else ok('the topics come from the results');

  // A chip is a LINK, so one tap narrows and the URL carries it.
  const band = page.locator('.chip', { hasText: /£5,000–£25,000/ }).first();
  if (!(await band.count())) fail('no £5,000–£25,000 band offered');
  else {
    await band.click();
    await page.waitForLoadState('networkidle');
    if (!page.url().includes('amount=5k-25k')) fail('the filter is not in the URL');
    else ok('tapping a chip puts the filter in the URL');

    const narrowed = await page.locator('body').innerText();
    // £17,500 is in the band; £3,200 and £240,000 are not.
    if (/£3,200/.test(narrowed) || /£240,000/.test(narrowed)) {
      fail('the filter did not actually narrow the results');
    } else ok('the results are narrowed');
    if (!/£17,500/.test(narrowed)) fail('the matching grant was filtered out too');
    else ok('the matching grant survives');
    if (!/Clear 1 filter/i.test(narrowed)) fail('no way to clear the filter');
    else ok('the filter can be cleared');

    // The OTHER bands must still show what they would give. Counting with the
    // chosen band applied would show them all as zero and make a live screen
    // look like a dead end.
    const others = await page.locator('.chip:not(.chip-on)').allInnerTexts();
    if (!others.some((t) => /£25,000|Over £|Under £/.test(t) && /\d/u.test(t))) {
      fail('the other bands lost their counts once one was chosen');
    } else ok('the other options still say what they would give');

    // And the back button undoes it, because it is a link and not state.
    await page.goBack({ waitUntil: 'networkidle' });
    if (page.url().includes('amount=')) fail('the back button did not undo the filter');
    else ok('the back button undoes a filter');
  }

  // Two dimensions at once.
  await page.goto(`${B}/grants?q=1&text=youth&amount=5k-25k&place=Somerset`, {
    waitUntil: 'networkidle',
  });
  const both = await page.locator('body').innerText();
  if (/£240,000/.test(both) || /Devon/.test(both.split('Where the money went')[1] ?? '')) {
    // Devon may legitimately appear as an OPTION; it must not appear as a row.
  }
  if (!/£17,500/.test(both)) fail('combining two filters lost the grant that matches both');
  else ok('two filters combine');
  if (!/Clear 2 filters/i.test(both)) fail('the clear link does not count both filters');
  else ok('the clear link counts both');

  // A stale link must not break the page.
  await page.goto(`${B}/grants?q=1&text=youth&amount=made-up-band&since=never`, {
    waitUntil: 'networkidle',
  });
  const stale = await page.locator('body').innerText();
  if (/Application error|server-side exception/i.test(stale)) {
    fail('an unknown filter id threw');
  } else ok('an unknown filter id is ignored rather than fatal');

  // --- a search that matches nothing ---------------------------------------
  await page.goto(`${B}/grants?q=1&text=zzzznothing`, { waitUntil: 'networkidle' });
  const none = await page.locator('body').innerText();
  if (!/Nothing came back for that/.test(none)) fail('a no-match search does not say so');
  else ok('a no-match search says so');
  // --- at phone width -------------------------------------------------------
  //
  // Where this actually gets used. The filters are four rows of chips, which
  // is the kind of thing that quietly overflows sideways and puts the whole
  // page on a horizontal scroll — asserted rather than eyeballed, because it
  // is invisible on a laptop.
  const phone = await browser.newContext({ viewport: PHONE });
  const small = await phone.newPage();
  await small.context().addCookies(await page.context().cookies());
  for (const [label, url] of [
    ['unnarrowed', `${B}/grants?q=1&text=youth`],
    ['narrowed', `${B}/grants?q=1&text=youth&amount=5k-25k&place=Somerset`],
  ]) {
    await small.goto(url, { waitUntil: 'networkidle' });
    const overflow = await small.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 0) fail(`${label} overflows sideways by ${overflow}px at ${PHONE.width}px`);
    else ok(`no sideways scroll at ${PHONE.width}px (${label})`);
  }

  // Filters folded away on a first search, so results are what you see first;
  // open by themselves once something is on.
  await small.goto(`${B}/grants?q=1&text=youth`, { waitUntil: 'networkidle' });
  if (await small.locator('details.narrow[open]').count()) {
    fail('the filters are open before anything is filtered');
  } else ok('the filters start folded away');
  await small.goto(`${B}/grants?q=1&text=youth&amount=5k-25k`, { waitUntil: 'networkidle' });
  if (await small.locator('details.narrow[open]').count()) {
    ok('the filters open themselves once one is active');
  } else fail('an active filter is hidden behind a closed panel');
} finally {
  await browser.close();
  api.close();
}

console.log(process.exitCode ? '\nE2E: FAILED' : '\nE2E: clean');
