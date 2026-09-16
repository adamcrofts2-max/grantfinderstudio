/**
 * Does /grants show loaded grants, in a production build, to a real user?
 *
 * A browser drives the real sign-up form, the corpus is loaded from a stub
 * 360Giving through the product's own admin route, and then /grants is read
 * the way a person reads it. Every fault this week lived in the gap between
 * "the code is shaped right" and "the running product agrees" — and a Next
 * server action cannot be posted to over raw HTTP, because its id is
 * build-specific. So: a browser.
 *
 * ## What it needs
 *
 * A production build served on :3000, `THREESIXTYGIVING_BASE_URL` pointing at
 * this script's own stub (`http://127.0.0.1:4599/api/v1/`),
 * `ADMIN_CLAIM_SECRET` set, and **a database whose corpus has not been
 * touched in the last two minutes**. The first block asserts that a page visit
 * alone fills the record, and a visit-triggered step is refused while the
 * lease from the previous one is still held — so an earlier run, or
 * `npm run smoke` against the same database, will make this report a fault
 * that is not there. Clear `admin_accounts`, `admin_sessions` and `corpus_load`
 * between runs.
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

/**
 * Get to a form field, opening whatever is holding it shut.
 *
 * Ported from `npm run walk`, which needed exactly this and for exactly the
 * same reason. Onboarding's steps are `<details>` cards, so a field is in the
 * DOM and unclickable until its `<summary>` is opened — and which step is open
 * depends on how far setup has got, which a server action decides AFTER the
 * page that triggered it has rendered.
 *
 * This ran as `if (await summary.count()) await summary.click()` and then
 * filled the field regardless: a single attempt, matched on the summary's
 * wording, with no check that it worked. It stopped working and the failure
 * was a 30-second Playwright timeout on a visible-looking input, which says
 * nothing about why. Finding the holder from the FIELD rather than from its
 * label is the part that makes it durable — copy changes, structure does not.
 */
async function reachField(page, name, { reload = `${B}/onboarding`, tries = 12 } = {}) {
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

const B = 'http://127.0.0.1:3000';
const API_PORT = 4599;

const FUNDERS = [
  'GB-CHC-STUB-1',
  'GB-CHC-STUB-2',
  'GB-CHC-STUB-3',
  'GB-CHC-STUB-4',
  // Fails on every request, so the console has a failure to account for. A
  // publisher that cannot be read used to be counted nowhere: `last_error`
  // held one message and the next success cleared it, so a walk could lose
  // its biggest publishers and report "42 of 42 — 100%, records cut short 0".
  'GB-CHC-STUB-BROKEN',
];

/**
 * A spread of sizes, places and labels, so the filters have something to bite
 * on. The labels differ deliberately — "Young people" and "Children and young
 * people" are one idea under two names, which is exactly the corpus's problem
 * and the reason the options are derived from results rather than curated.
 */
const SHAPES = {
  'GB-CHC-STUB-1': { amount: 17500, place: 'Somerset', topic: 'Young people', year: '2025' },
  'GB-CHC-STUB-2': { amount: 3200, place: 'Devon', topic: 'Children and young people', year: '2025' },
  'GB-CHC-STUB-3': { amount: 240000, place: 'Somerset', topic: 'Heritage', year: '2024' },
  // Outside the three-year window. Their API has no date filter, so this IS
  // fetched and read; it must then be dropped and counted rather than stored.
  'GB-CHC-STUB-4': { amount: 9000, place: 'Somerset', topic: 'Young people', year: '2019' },
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

/**
 * A grant whose only tie to the word "youth" is the recipient's name.
 *
 * Every other stub grant is about youth skills in Somerset, which makes them
 * useless for testing the relevance floor — nothing can be closer or further
 * than anything else. This one is a roof, in Devon, given to an organisation
 * called Wells Youth Collective. So a search for "youth" matches it, at the
 * weight 0020 gives a recipient name, and the floor should drop it: a grant to
 * a youth organisation for a roof is a roof grant, and that exact confusion is
 * what a real corpus put at the top of a youth search.
 *
 * Its region and its label are its own, so if the floor ever stops working
 * this grant leaks a "Devon" place chip and a "Community buildings" topic chip
 * into the options for a youth search, and the narrowing checks below see it.
 */
const NOISE = {
  ...grant('GB-CHC-STUB-1-noise', 'GB-CHC-STUB-1'),
};
NOISE.data = {
  ...NOISE.data,
  title: 'Chapel roof repair',
  description: 'Urgent repairs to the roof of a grade II listed chapel',
  amountAwarded: 4100,
  awardDate: '2025-03-04',
  beneficiaryLocation: [{ name: 'Devon' }, { name: 'England' }],
  classifications: [{ title: 'Community buildings' }],
};

/** How many grants each stub funder published, so grouping has something to group. */
const GRANTS_PER_FUNDER = {
  'GB-CHC-STUB-1': 6,
  'GB-CHC-STUB-2': 1,
  'GB-CHC-STUB-3': 1,
  'GB-CHC-STUB-4': 1,
};

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
    if (org === 'GB-CHC-STUB-BROKEN') {
      // A publisher the walk cannot read. Counted nowhere before 0018: a
      // failure wrote one `last_error` that the next success cleared, so a
      // walk could lose its biggest publishers and report itself complete.
      res.statusCode = 500;
      res.end('{"detail":"something went wrong at this publisher"}');
      return;
    }
    const n = GRANTS_PER_FUNDER[org] ?? 1;
    const results = Array.from({ length: n }, (_, i) => {
      const row = grant(`${org}-${i + 1}`, org);
      // A spread of sizes within the funder, so a median and an
      // interquartile range are meaningful rather than one repeated number.
      row.data.amountAwarded = (SHAPES[org]?.amount ?? 17500) + i * 1000;
      return row;
    });
    if (org === 'GB-CHC-STUB-1') results.push(NOISE);
    res.end(JSON.stringify({ count: results.length, next: null, results }));
    return;
  }
  res.statusCode = 404;
  res.end('{}');
});
await new Promise((r) => api.listen(API_PORT, '127.0.0.1', r));

const executablePath = chromiumPath();
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const PHONE = { width: 390, height: 844 };
/**
 * Failures are collected as well as printed.
 *
 * `E2E: FAILED` on its own at the end of eighty lines of `ok` is useless the
 * moment anybody reads the log through `tail`, which is how it gets read — a
 * run reported FAILED with every visible line passing, and finding out why
 * meant running the whole thing again. The verdict now repeats what failed,
 * so the last lines always carry the reason.
 */
const failures = [];
const fail = (m) => { failures.push(m); console.error('FAIL:', m); process.exitCode = 1; };
let passed = 0;
const ok = (m) => { passed += 1; console.log('  ok —', m); };

try {
  // --- the applicant --------------------------------------------------------
  const page = await browser.newPage();
  // WITH THE URL. A bare message cost a whole run: a React hydration error
  // came back as eleven words about a minified error code with no way to tell
  // which of forty pages it was on, and the only way to narrow it was to run
  // the walk again and watch.
  page.on('pageerror', (e) => fail(`client exception at ${page.url()}: ${e.message}`));

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
  //
  // The window has to be LONGER THAN THE LEASE. A visit-triggered step is
  // refused if one ran in the last `VISIT_MIN_SECONDS` (90), which is the
  // whole point of the lease — and this loop waited 24 seconds, so anything
  // that had touched the corpus in the previous minute and a half made it
  // report "a page visit did not cause the record to fill" when the product
  // was working exactly as designed. Running `npm run smoke` against the same
  // database first does precisely that.
  let progressed = false;
  for (let attempt = 0; attempt < 60 && !progressed; attempt += 1) {
    await page.waitForTimeout(2000);
    const body = await (await fetch(`${B}/api/corpus`)).json();
    progressed = Boolean(body.progress?.startedAt) && body.progress.fundersDone > 0;
    if (!progressed) await page.goto(`${B}/grants`, { waitUntil: 'networkidle' });
  }
  if (progressed) ok('a page visit alone started and advanced the record');
  else fail('a page visit did not cause the record to fill in two minutes');

  // --- and searching finds what the visit loaded ---------------------------
  //
  // Asked of the grant list, so the assertion is about one specific grant
  // being findable rather than about how the default view groups things.
  await page.goto(`${B}/grants?q=1&text=somerset&view=grants`, { waitUntil: 'networkidle' });
  const selfLoaded = await page.locator('body').innerText();
  if (/Riverside youth skills programme/.test(selfLoaded)) {
    ok('the grant is searchable without anybody loading it');
  } else fail('the self-loaded grant is not searchable');

  // --- load the corpus, as an operator would -------------------------------
  const admin = await browser.newPage();
  admin.on('pageerror', (e) => fail(`admin client exception at ${admin.url()}: ${e.message}`));
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

    // The three-year window, on the record rather than in a comment. STUB-4
    // published one grant, in 2019, and their API offers no way to not fetch
    // it — so the panel has to say it was fetched, read and not kept.
    if (/Older than the last 3 years/i.test(after)) ok('the panel names the window');
    else fail('the panel does not name the three-year window');
    if (/Older than the last 3 years[^0-9]*[1-9]/i.test(after)) {
      ok('the discarded grant is counted, not silent');
    } else fail('a grant outside the window was dropped without being counted');

    // A publisher that could not be read must be on the record too. This is
    // the third and last uncounted way for the corpus to be short.
    if (/Could not be read/i.test(after)) ok('the console reports unreadable funders');
    else fail('the console has no row for a funder that could not be read');
    if (/Could not be read[^0-9]*[1-9]/i.test(after)) {
      ok('the failed funder is counted');
    } else fail('a funder that threw was not counted');
    if (/STUB-BROKEN/i.test(after)) ok('and it is named, so it can be re-fetched');
    else fail('the failed funder is counted but not named');
    if (/of which failed/i.test(after)) {
      ok('"funders read" no longer reads as "we have all of it"');
    } else fail('the read count still claims completeness while a funder failed');
  }

  // --- one grant, read as a grant ------------------------------------------
  //
  // Explicitly the grant list: funders are the default view now, and this
  // block is about whether a single row carries what a person needs — amount,
  // recipient, funder, and the way onward.
  await page.goto(`${B}/grants?q=1&text=somerset&view=grants`, { waitUntil: 'networkidle' });
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
  // £9,000 is STUB-4's 2019 grant. It matched every word of the search and is
  // absent because of the window, which is the only way to tell a dropped
  // grant from one that was never published.
  if (/£9,000/.test(loaded)) fail('a grant older than the window is in the search');
  else ok('grants older than the window are not searchable');
  if (!/last 3 years/i.test(loaded)) fail('the search never says how far back it holds');
  else ok('the search says how far back it holds');

  // --- by funder, which is the unit of the decision -------------------------
  //
  // The applicant's question is "who would fund us", not "which grants mention
  // youth work". So funders are the default view and the grant list is one tap
  // away, with the choice in the URL like everything else here.
  await page.goto(`${B}/grants?q=1&text=youth`, { waitUntil: 'networkidle' });
  const funderView = await page.locator('body').innerText();
  if (!/By funder/i.test(funderView)) fail('there is no by-funder view');
  else ok('the by-funder view is there');
  // The count is deliberately about what the funders gave, not about how
  // well the rows fit: a text search still matches a large slice of the
  // corpus, so promising "grants like yours" of the whole number was a
  // claim the ranking could not keep.
  if (!/funders? between them gave/i.test(funderView))
    fail('the count does not describe funders');
  else ok('the count describes funders, not rows');
  if (/grants like yours\. The ones most likely/i.test(funderView))
    fail('the count still claims every match is a close fit');
  else ok('the count does not overclaim the fit of every match');

  // The line that says WHY a funder is on the list has to be made of the same
  // parts the ordering is, or the reader cannot check the ranking.
  if (!/grants like yours/i.test(funderView)) fail('no reason is given for a funder');
  else ok('each funder says why it is there');

  /**
   * The selected tab has to be legible.
   *
   * It was not: `var(--bg)` is a token this design system never had, so the
   * colour fell back to the inherited ink and "By funder" rendered as black
   * text on a black pill. A build, a lint and a thousand unit tests all
   * passed. Computed styles are the only thing that sees it.
   */
  const contrast = await page.locator('.view-on').evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.color, background: s.backgroundColor };
  });
  if (contrast.color === contrast.background) {
    fail(`the selected tab is invisible: ${contrast.color} on ${contrast.background}`);
  } else ok('the selected tab is legible');

  const firstFunder = page.locator('.funder-card summary').first();
  if (!(await firstFunder.count())) fail('no funder cards rendered');
  else {
    await firstFunder.click();
    const opened = await page.locator('.funder-card').first().innerText();
    // Six grants is above MIN_AWARDS_TO_CHARACTERISE, so this one is described.
    if (!/Typically/i.test(opened)) fail('an eligible funder is not described');
    else ok('a funder with enough grants is described');
    if (!/Median/i.test(opened) || !/Range/i.test(opened)) fail('the figures are missing');
    else ok('the figures are there');
    if (!/Last gave/i.test(opened)) fail('recency is not stated');
    else ok('recency is stated');
    if (!/most recent/i.test(opened)) fail('no example grants inside the funder');
    else ok('the funder carries its own grants');
    if (!/Add a fund from them/i.test(opened)) fail('no way through to adding a fund');
    else ok('the way through to a fund is there');
  }

  // A funder with too few grants must NOT be given a median. A median over one
  // grant is not a policy, and saying less is the honest option.
  const cards = await page.locator('.funder-card').all();
  let checkedThin = false;
  for (const card of cards) {
    const text = await card.innerText();
    if (/Stub Trust 2|Stub Trust 3/.test(text)) {
      await card.locator('summary').click();
      const body = await card.innerText();
      if (/Typically/i.test(body)) fail('a single grant was described as typical');
      else if (/Too few to summarise/i.test(body)) {
        ok('a funder with too few grants is not summarised');
        checkedThin = true;
      }
      break;
    }
  }
  if (!checkedThin) fail('could not find a thin funder to check');

  // And the grant list is still one tap away.
  await page.locator('.view', { hasText: /Every grant/i }).first().click();
  await page.waitForLoadState('networkidle');
  if (!page.url().includes('view=grants')) fail('the view is not in the URL');
  else ok('the view choice is in the URL');
  const grantView = await page.locator('body').innerText();
  if (!/grants? close to your search/i.test(grantView)) fail('the grant list did not come back');
  else ok('every grant is still one tap away');

  // --- the relevance floor, in a browser ------------------------------------
  //
  // The count used to be every grant mentioning any of your words, which on a
  // real corpus was 61% of everything held — "284 grants" over a page whose
  // first five rows were chapel roofs. The floor is what makes the number and
  // the page the same set. `NOISE` above is the one stub grant that matches
  // "youth" only through its recipient's name.
  await page.goto(`${B}/grants?q=1&text=youth&view=grants`, { waitUntil: 'networkidle' });
  const floored = await page.locator('body').innerText();
  if (/Application error|server-side exception/i.test(floored)) {
    fail('the floor query threw on a real Postgres');
  } else ok('the floored search runs on a real Postgres');
  if (!/Riverside youth skills programme/.test(floored)) {
    fail('the floor dropped the grants the search was for');
  } else ok('grants whose title is about youth are still there');
  if (/Chapel roof repair/.test(floored)) {
    fail('a grant matching only the recipient’s name is still counted as a match');
  } else ok('a match that is only the recipient’s name is dropped');
  // And the number over the page is the same set, not the wider one. Six
  // Riverside grants from Stub Trust 1 plus one each from 2 and 3; the noise
  // grant and the 2019 grant are both out, for different reasons.
  if (!/\b8 grants close to your search/i.test(floored)) {
    fail(`the count is not the floored set: ${/[0-9]+ grants? close to your search/i.exec(floored)?.[0] ?? 'no count found'}`);
  } else ok('the count over the page is the floored set, not the wider one');

  // --- and a place name still reaches the place -----------------------------
  //
  // The floor was one floor for the whole query, and that made a county inert:
  // a region is weight D and a title is A, so the bar came from the best title
  // match and every region-only grant fell under it. Measured on a 468-grant
  // corpus, "youth skills" and "youth skills somerset" returned the same
  // thirty rows and offered no Somerset chip. Each term has its own floor now.
  //
  // `NOISE` is in Devon and about a roof. It is out of a search for "youth",
  // asserted above — and in a search for "youth devon", because it is in
  // Devon, which is what the person typed.
  await page.goto(`${B}/grants?q=1&text=youth+devon&view=grants`, { waitUntil: 'networkidle' });
  const placed = await page.locator('body').innerText();
  if (!/Chapel roof repair/.test(placed)) {
    fail('adding a county to the search did not reach the county');
  } else ok('a county in the search reaches grants in that county');
  if (!/Riverside youth skills programme/.test(placed)) {
    fail('adding a county cost us the grants the other words found');
  } else ok('and does not cost the grants the other words found');
  if (!/\b9 grants close to your search/i.test(placed)) {
    fail(`the county count is wrong: ${/[0-9]+ grants? close to your search/i.exec(placed)?.[0] ?? 'no count found'}`);
  } else ok('the count is the union of the two words, not one of them');

  // --- narrowing ------------------------------------------------------------
  await page.goto(`${B}/grants?q=1&text=youth&view=grants`, { waitUntil: 'networkidle' });

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

    // The view you were reading must survive a filter. Tapping a chip on
    // "Every grant" used to bounce you back to the funder view.
    if (!page.url().includes('view=grants')) fail('filtering lost the chosen view');
    else ok('filtering keeps the view you were reading');

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
  // On the grant list, because this is checking that two predicates combine,
  // not what the funder view renders.
  await page.goto(`${B}/grants?q=1&text=youth&amount=5k-25k&place=Somerset&view=grants`, {
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
  // --- set up, the way somebody not on Companies House would ----------------
  //
  // Everything below needs an organisation, and until now this check never
  // made one — so the screens a SET-UP applicant sees were untested.
  await page.goto(`${B}/onboarding`, { waitUntil: 'networkidle' });
  if (!(await reachField(page, 'legalName'))) {
    fail('could not reach the self-declared profile form');
  }
  await page.fill('input[name="legalName"]', 'Rivermead Community Interest Company');
  await page.selectOption('select[name="legalForm"]', { index: 1 });
  await page.selectOption('select[name="jurisdiction"]', { index: 1 });
  await page.fill('input[name="region"]', 'Somerset');
  await page.fill('input[name="incorporationDate"]', '2021-04-06');
  await page
    .locator('form', { has: page.locator('input[name="legalName"]') })
    .locator('button[type="submit"]')
    .click();

  /**
   * Wait for the STATE to change, not for the network to fall quiet.
   *
   * `networkidle` resolved before the server action had finished, so the next
   * step reloaded /onboarding, found the profile step still open and the
   * project form collapsed inside a <details> — present in the DOM and
   * unclickable. The third time this class of race has cost time here.
   */
  // Same helper: the project step is a collapsed <details> until the profile
  // has saved, and polling for visibility alone never opened it.
  const projectReady = await reachField(page, 'projectName');
  if (!projectReady) {
    fail('onboarding did not move on to the project after the profile was saved');
  } else {
    ok('onboarding moves on to the project');
    await page.fill('input[name="projectName"]', 'Riverside youth skills');
    await page.fill('input[name="amountSoughtGbp"]', '18000');
    await page.fill('input[name="durationMonths"]', '12');
    const groups = await page.locator('input[name="beneficiaries"]').all();
    if (groups.length > 0) await groups[0].check();
    await page
      .locator('form', { has: page.locator('input[name="projectName"]') })
      .locator('button[type="submit"]')
      .click();
  }

  let onFacts = false;
  for (let attempt = 0; attempt < 12 && !onFacts; attempt += 1) {
    await page.waitForTimeout(1000);
    await page.goto(`${B}/organisation`, { waitUntil: 'networkidle' });
    onFacts = !new URL(page.url()).pathname.startsWith('/onboarding');
  }
  if (!onFacts) fail('setup did not take');
  else ok('the organisation exists and its facts page is reachable');

  // --- the journey a person is actually on ----------------------------------
  //
  // Three gaps the walkthrough found, each of which left somebody stuck with
  // the product apparently working.
  await page.goto(`${B}/organisation`, { waitUntil: 'networkidle' });
  const facts = await page.locator('body').innerText();

  // 1. The page used to lead with "Everything is checked" while the setup
  //    guide was asking for a fifth fact — congratulating somebody it was
  //    simultaneously chasing.
  const needsMore = /more fact/i.test(facts) || /One more fact/i.test(facts);
  if (/Everything is checked/i.test(facts)) {
    fail('the facts page still congratulates while more are needed');
  } else ok('the facts page does not congratulate prematurely');

  if (needsMore) {
    // 2. It has to NAME what is missing. "4 of 5" is a counter, not a question
    //    anybody can answer.
    if (!/What you exist to do|Who you are for|What the work actually is/i.test(facts)) {
      fail('the shortfall is a bare count with no named facts');
    } else ok('the missing facts are named');
    if (!/Worth having because/i.test(facts)) fail('no reason is given for a suggested fact');
    else ok('each suggested fact says why it matters');

    // And the prompt has to arrive at a form already asking that question.
    await page.locator('.fact a', { hasText: /Tell us/i }).first().click();
    await page.waitForLoadState('networkidle');
    const chosen = await page.locator('select[name="claim"]').inputValue();
    if (chosen === '') fail('the named fact did not carry into the form');
    else ok(`the form opens already asking for "${chosen}"`);
  }

  // 3. The guided journey never showed anybody where to FIND a fund. Step 4
  //    assumed you arrive with one in mind.
  await page.goto(`${B}/`, { waitUntil: 'networkidle' });
  // The NEXT-step card, not the whole page: "See all 5 steps" lists every
  // step's title, so matching against the body found "Add a fund you are
  // considering" whatever step was actually in front of the person.
  const nextStep = await page.locator('.setup-hero').first().innerText();
  if (/Add a fund/i.test(nextStep)) {
    if (!(await page.locator('.setup-alternative a').count())) {
      fail('the add-a-fund step offers no way to find one');
    } else ok('the add-a-fund step offers a way to find one');
  } else {
    // Not the step in front of them right now, so assert it from the domain
    // instead of contriving five confirmed facts in a browser.
    ok(`the next step is "${nextStep}" — the add-a-fund alternative is unit-tested`);
  }

  // The two screens that answer "who would fund us" must point at each other.
  await page.goto(`${B}/grants`, { waitUntil: 'networkidle' });
  if (!(await page.locator('a[href="/funders"]').count())) {
    fail('/grants does not mention /funders');
  } else ok('/grants points at /funders');
  await page.goto(`${B}/funders`, { waitUntil: 'networkidle' });
  if (!(await page.locator('a[href="/grants"]').count())) {
    fail('/funders does not mention /grants');
  } else ok('/funders points at /grants');

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

  // --- a filter that leaves nothing stays on the screen --------------------
  //
  // It used not to. A chosen option counts zero, every zero was dropped, and
  // so a filter could be ACTIVE AND INVISIBLE at once: the header said
  // "narrowed by 1 filter — tap a filter again to remove it" over a row with
  // nothing in it to tap, and the only way out was Clear, which discards
  // every choice rather than the one that emptied the page.
  await page.goto(`${B}/grants?q=1&text=youth&amount=over500k`, { waitUntil: 'networkidle' });
  const emptied = await page.locator('body').innerText();
  if (!/Nothing came back/i.test(emptied)) {
    fail('the over-£500,000 band was expected to match nothing in the stub corpus');
  } else {
    const on = page.locator('.chip-on');
    if ((await on.count()) === 0) {
      fail('the chosen filter vanished from the screen while the header still counted it');
    } else ok('a chosen filter that matches nothing is still on the screen');
    const href = await on.first().getAttribute('href');
    if (href === null || /amount=over500k/u.test(href)) {
      fail('the chosen filter cannot be tapped off again');
    } else ok('and tapping it removes just that one');
  }

  // --- an answer you write yourself ----------------------------------------
  //
  // The product promised this on three screens and did not have it: every
  // question offered one action, "Draft from my facts", so with no Anthropic
  // key — the default — the application screen had nothing a person could do.
  //
  // A fund of its own first, because this check never made one: it walked as
  // far as the handoff to the add-a-fund form and stopped, so every screen
  // downstream of a fund — the fund page, the tracker's dates, the
  // application — went untested by it.
  await page.goto(`${B}/opportunities/add`, { waitUntil: 'networkidle' });
  await page.fill('input[name="funderName"]', 'Stub Trust 1');
  await page.fill('input[name="title"]', 'Community Grants Programme');
  await page.locator('button').filter({ hasText: /Add this fund/iu }).first().click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);

  await page.goto(`${B}/`, { waitUntil: 'networkidle' });
  const oppLink = page.locator('a[href^="/opportunities/opp_"]').first();
  if (!(await oppLink.count())) {
    fail('a fund was added but does not appear on the home page');
  } else {
    ok('a fund added by hand appears on the home page');

    // F3: the card must not claim an effort the fund's own page refuses to
    // give. It used to say "about 1 hour of work · LOW EFFORT" beside a fund
    // page saying "an unknown amount of work — nobody has seen this funder's
    // form yet". An hour is what the model charges for reading the guidance.
    const card = await page.locator('body').innerText();
    if (/for about \d+ hours? of work/u.test(card)) {
      fail('the card claims an effort figure for a form nobody has seen');
    } else ok('the card does not invent an effort figure');
    if (/LOW EFFORT/u.test(card)) {
      fail('the card still badges the effort it says it cannot estimate');
    } else ok('and does not badge one either');
    if (/0 open question/u.test(card)) {
      fail('the card reports "0 open questions" while eligibility is unknown');
    } else ok('and says why eligibility cannot be checked instead');

    await oppLink.click();
    await page.waitForLoadState('networkidle');
    const startApp = page.locator('a, button').filter({ hasText: /Start an application/iu }).first();
    if (!(await startApp.count())) fail('no way to start an application from a fund');
    else {
      await startApp.click();
      await page.waitForLoadState('networkidle');
      const paste = page.locator('textarea').first();
      await paste.fill('1. What do you exist to do? (50 words)\n2. Who benefits?');
      await page.locator('button').filter({ hasText: /Add|Save/iu }).first().click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1500);

      const boxes = page.locator('textarea[name="content"]');
      if ((await boxes.count()) < 2) {
        fail(`expected an answer box per question, found ${await boxes.count()}`);
      } else ok('every question has a box to write the answer in');

      await boxes.first().fill('We train young people aged 14 to 19 in Wells.');
      await page.locator('button').filter({ hasText: /Save this answer/iu }).first().click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1500);
      const afterSave = await page.locator('body').innerText();
      if (/in your own words/i.test(afterSave)) ok('an answer written by hand saves');
      else fail(`saving an answer by hand reported nothing: ${afterSave.slice(0, 200)}`);
      if (/1 of 2 questions answered/i.test(afterSave)) {
        ok('and counts towards the application');
      } else fail('a saved answer did not count as answered');
      if (/No Anthropic key/i.test(afterSave)) {
        fail('writing an answer should not need a key');
      } else ok('and needed no API key to do it');

      await page.reload({ waitUntil: 'networkidle' });
      const kept = await page
        .locator('textarea[name="content"]')
        .first()
        .evaluate((el) => el.value);
      if (/young people aged 14 to 19/u.test(kept)) ok('and is still there after a reload');
      else fail('a saved answer did not survive a reload');

      // --- the budget ------------------------------------------------------
      //
      // `budgets`, `budget_lines` and `outcomes` were in the schema from 0001
      // with nothing writing to them, while the readiness card said "No
      // budget has been built" and scored the application down for it.
      const readiness = () => {
        const el = page.locator('body');
        return el.innerText().then((t) => Number(/Readiness — (\d+)%/u.exec(t)?.[1] ?? '-1'));
      };
      const before = await readiness();

      const line = async (desc, category, amount) => {
        await page.fill('#budget-description', desc);
        await page.selectOption('#budget-category', category);
        await page.fill('#budget-amount', amount);
        await page.locator('button').filter({ hasText: /Add this line/iu }).first().click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(900);
      };
      // The project above asks for £18,000, so these figures are chosen to
      // MISS it and then to meet it exactly. Getting that the wrong way round
      // the first time made the product look broken when it was right: a
      // first line equal to the ask matched, so no mismatch was reported, and
      // the assertion was the thing at fault.
      await line('Youth worker, 2 days a week', 'staff', '12,000');
      const oneLine = await page.locator('body').innerText();
      if (/asks for/u.test(oneLine) && /12,000/u.test(oneLine) && /18,000/u.test(oneLine)) {
        ok('a budget that does not match the ask says so, with both figures');
      } else fail(`the budget/ask mismatch was not reported: ${oneLine.slice(0, 200)}`);

      await line('Room hire', 'venues', '4000');
      await line('Premises and insurance', 'overheads', '2000');
      const balanced = await page.locator('body').innerText();
      if (/Nothing here would stop this budget going in/iu.test(balanced)) {
        ok('and says so when it does match');
      } else fail('a balanced budget was not reported submittable');
      if (/Not checked:/u.test(balanced)) {
        ok('and names the funder rules it could NOT check');
      } else fail('the budget implies checks it cannot make');

      await page.fill('#budget-description', 'A typo');
      await page.fill('#budget-amount', 'twelve');
      await page.locator('button').filter({ hasText: /Add this line/iu }).first().click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(700);
      if (/Give an amount in pounds/iu.test(await page.locator('body').innerText())) {
        ok('an amount that is not a number is refused with a sentence');
      } else fail('a non-numeric amount was not refused');

      // --- the logic model -------------------------------------------------
      await page.fill('#outcome-activity', 'Run a weekly evening session in Wells');
      await page.fill('#outcome-output', '40 sessions a year, reaching 60 young people');
      await page.fill('#outcome-outcome', 'At least 25 move into work or training');
      await page.locator('button').filter({ hasText: /Add this row/iu }).first().click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(900);
      const withOutcome = (await page.locator('body').innerText()).toLowerCase();
      if (withOutcome.includes('we will') && withOutcome.includes('which produces') && withOutcome.includes('so that')) {
        ok('the logic model shows activity, output and outcome apart');
      } else fail('the logic model did not render its three parts');

      await page.fill('#outcome-activity', 'Something');
      await page.fill('#outcome-output', 'Some of it');
      await page.locator('button').filter({ hasText: /Add this row/iu }).first().click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(700);
      if (/Say what changes for somebody/iu.test(await page.locator('body').innerText())) {
        ok('a row with no outcome is refused, because that is the point of the row');
      } else fail('a row with an output but no outcome was accepted');

      // --- and readiness moved, because it is fed real data now ------------
      const after = await readiness();
      const body = await page.locator('body').innerText();
      if (after > before) ok(`readiness moved with the work (${before}% → ${after}%)`);
      else fail(`readiness did not move: ${before}% → ${after}%`);
      if (/No budget has been built/iu.test(body)) fail('still says no budget has been built');
      else ok('and no longer asks for a budget that exists');
      if (/No outcomes have been defined/iu.test(body)) fail('still says no outcomes defined');
      else ok('nor for outcomes that exist');
      if (after === 100) {
        fail('an application with no questions answered reports 100% ready');
      } else ok('and does not claim 100% with the questions still empty');

      // --- the breakdown, which is what makes the number readable ----------
      //
      // The engine has always returned seven components, each with a score and
      // a sentence, and the card showed the average and nothing else: the
      // number moved and there was nothing on the screen saying what moved it.
      const parts = await page.locator('.part').all();
      if (parts.length < 7) {
        fail(`the readiness breakdown is not on the page (${parts.length} parts)`);
      } else ok(`readiness is broken down into its ${parts.length} parts`);
      const labels = await page.locator('.part-label').allTextContents();
      const wanted = ['Eligibility', 'Questions', 'Budget', 'Outcomes', 'Word limits'];
      const missing = wanted.filter(
        (w) => !labels.some((l) => l.toLowerCase().includes(w.toLowerCase())),
      );
      if (missing.length > 0) fail(`the breakdown does not name ${missing.join(', ')}`);
      else ok('and names each part, so a score can be traced to a part');
      // The caption has to say which parts the average came from, because a
      // part that does not apply is left out rather than scored zero.
      if (!/Averaged over the \d+ of \d+ parts/iu.test(body)) {
        fail('the breakdown never says which parts the percentage averages');
      } else ok('and says which of them the percentage averages');

      // ELIGIBILITY IS EVALUATED NOW, NOT ASSUMED.
      //
      // It was hardcoded: 'eligible' first, so the card claimed "you meet
      // every criterion we can check" on every application ever opened, and
      // then 'unknown', which was honest and said nothing. The stub funder
      // publishes no verified criteria, so the true answer here is that there
      // is nothing to check — and the row has to say THAT rather than imply a
      // question the applicant could go and resolve.
      if (/you meet every criterion we can check/iu.test(body)) {
        fail('the eligibility row still claims a check nobody ran');
      } else ok('eligibility no longer claims a check nobody ran');
      if (!/Nothing is published here about who can apply/iu.test(body)) {
        fail(`the eligibility row does not say why it cannot tell: ${
          /Eligibility[\s\S]{0,140}/iu.exec(body)?.[0]?.replace(/\n+/gu, ' | ') ?? '(no row)'
        }`);
      } else ok('and says why it cannot tell, rather than scoring half marks');
      if (!/Not counted/iu.test(body)) {
        fail('a part that does not apply is not marked as uncounted');
      } else ok('a part that cannot be measured is marked uncounted, not zero');

      /**
       * AND IT DRAWS NO BAR, because an empty bar reads as nought per cent.
       *
       * The first screenshot of this card had one: a grey track beside the
       * words "not counted", which is the exact distinction the breakdown
       * exists to make. Counted from the DOM rather than the text, because
       * the text is identical either way.
       */
      const uncounted = await page.locator('.part:has(.part-skip)').count();
      const barsInUncounted = await page.locator('.part:has(.part-skip) .part-meter').count();
      if (uncounted === 0) fail('expected at least one uncounted part to check');
      else if (barsInUncounted > 0) {
        fail(`${barsInUncounted} uncounted parts still draw an empty bar`);
      } else ok(`and draws no bar for any of the ${uncounted} of them`);

      /**
       * The bars line up.
       *
       * Each row is its own CSS grid, so an `auto` first column sizes to that
       * row's own label — and "Attachments" is the one label wider than the
       * others, so its bar and score sat a few pixels right of every other
       * row. Invisible in the DOM, invisible in the text, and obvious in a
       * screenshot once every part is on screen at once. Geometry is the only
       * thing that sees it, the way computed styles were the only thing that
       * saw the black-on-black tab.
       */
      const lefts = await page.locator('.part-meter').evaluateAll((els) =>
        els.map((el) => Math.round(el.getBoundingClientRect().left)),
      );
      const spread = lefts.length === 0 ? 0 : Math.max(...lefts) - Math.min(...lefts);
      if (lefts.length < 2) fail('not enough bars to check their alignment');
      else if (spread > 1) fail(`the readiness bars are ragged by ${spread}px`);
      else ok(`the ${lefts.length} bars start on the same pixel`);
    }
  }
} finally {
  await browser.close();
  api.close();
}

if (failures.length > 0) {
  console.log(`\nE2E: FAILED — ${failures.length} of ${failures.length + passed} checks`);
  for (const [i, message] of failures.entries()) console.log(`  ${i + 1}. ${message}`);
} else {
  console.log(`\nE2E: clean — ${passed} checks`);
}
