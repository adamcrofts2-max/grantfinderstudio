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
 * `npm run build`, and `DATABASE_URL` pointing at a Postgres on this machine.
 * Nothing else: it starts its own stub publisher, resets the state it depends
 * on, starts its own server on its own port with its own environment, and
 * stops both afterwards.
 *
 * ## Why it provisions itself
 *
 * Because it did not, and the cost was paid three sessions running. The
 * assertions need a corpus that only its own stub has written, a database with
 * no admin account (the first block signs in through the claim flow, which
 * disappears once one exists) and a corpus lease that is not still held from
 * a previous run. None of that was enforced — it was a paragraph in this
 * comment asking a human to clear three tables — so a second run in the same
 * afternoon reported 23 failures of 117, every one of them the rig describing
 * itself. A harness that reports faults that are not there is worse than no
 * harness: it trains you to disbelieve it, and the one real failure in the
 * list goes unread.
 *
 * It also starts its own SERVER, on port 3100 rather than 3000, for the
 * neighbouring fault: a `next start` left running through a rebuild serves
 * chunks that no longer exist, and a server on the right port pointed at the
 * WRONG stub answers every request perfectly while testing nothing. Owning
 * the process means owning its environment — the stub URL and the admin claim
 * secret are set by this script, so neither can be missing or stale.
 *
 * `BASE_URL` still points it at a server somebody else is running — a deployed
 * preview, say. Then it touches neither the database nor any process, because
 * it no longer knows whose they are.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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

/**
 * Its own port, not 3000.
 *
 * A dev server on the usual port is the likeliest thing in the way, and an
 * e2e that quietly runs against whatever answers there is an e2e that can
 * pass while testing the wrong build. 3100 unless something else is told to
 * it.
 */
const PORT = Number(process.env['E2E_PORT'] ?? 3100);
/** Somebody else's server, if they gave us one. Then we own nothing. */
const GIVEN = process.env['BASE_URL'];
const OWN_SERVER = GIVEN === undefined || GIVEN === '';
const B = OWN_SERVER ? `http://127.0.0.1:${PORT}` : GIVEN;
const API_PORT = Number(process.env['E2E_API_PORT'] ?? 4599);

/**
 * The secret the console's claim flow asks for.
 *
 * Generated here and handed to the server this script starts, so the run
 * never depends on an operator having exported one — and so the value is
 * different every time rather than sitting in a shell history.
 */
const CLAIM_SECRET =
  process.env['ADMIN_CLAIM_SECRET'] ?? randomBytes(32).toString('base64url');

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
/**
 * Bind the stub, and say plainly when something already has that port.
 *
 * Unhandled, this came out as a twenty-line Node stack trace about
 * EADDRINUSE with no mention of what the port is for or what to do — the same
 * class of fault as the ones this script exists to stop reporting.
 */
await new Promise((resolve, reject) => {
  api.once('error', (error) => {
    reject(
      error.code === 'EADDRINUSE'
        ? new Error(
            `Something is already serving 127.0.0.1:${API_PORT}, which this walk needs for ` +
              `its stub publisher. Stop it, or run with E2E_API_PORT set to a free port.`,
          )
        : error,
    );
  });
  api.listen(API_PORT, '127.0.0.1', resolve);
});

/**
 * A Resend-shaped inbox.
 *
 * The server this walk starts is given a Resend key and pointed here, so a
 * password reset goes through the REAL adapter — the real request, the real
 * email, the real link — and lands somewhere this script can read it. Only
 * `POST /emails` exists, because that is all the product ever calls.
 */
const MAIL_PORT = Number(process.env['E2E_MAIL_PORT'] ?? 4598);
const outbox = [];
const mail = createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/emails') {
    res.statusCode = 404;
    res.end('{}');
    return;
  }
  if (req.headers.authorization !== 'Bearer re_e2e_stub_not_a_real_key') {
    res.statusCode = 401;
    res.end('{"message":"bad key"}');
    return;
  }
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    outbox.push(JSON.parse(body));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: `email_${outbox.length}` }));
  });
});
if (OWN_SERVER) {
  await new Promise((resolve, reject) => {
    mail.once('error', (error) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(
              `Something is already serving 127.0.0.1:${MAIL_PORT}, which this walk needs for ` +
                `its stub inbox. Stop it, or run with E2E_MAIL_PORT set to a free port.`,
            )
          : error,
      );
    });
    mail.listen(MAIL_PORT, '127.0.0.1', resolve);
  });
}

/* ------------------------------------------------------------------ *
 * Our own database state, and our own server.
 * ------------------------------------------------------------------ */

/**
 * Whether this connection string points at this machine.
 *
 * The only guard on the reset below, and it is the one that matters: the
 * production database is somewhere else. A script that deletes tables must
 * not be one command-line argument away from doing it to a customer's data,
 * and "is it local" is a question with an answer rather than a judgement.
 */
function isLocal(connectionString) {
  try {
    const { hostname } = new URL(connectionString);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

/**
 * Put the database back to the state these assertions describe.
 *
 * Three tables, and each one is a fault this script has actually reported as
 * if it were the product's:
 *
 *   - `admin_accounts` / `admin_sessions`. The console is reached through the
 *     claim flow, which exists only until the first admin does. A second run
 *     in the same database met a sign-in form it had no password for and
 *     reported seven failures about the corpus panel.
 *   - `corpus_load`. Its lease refuses a visit-triggered step within
 *     `VISIT_MIN_SECONDS`, so a previous run — or `npm run smoke` against the
 *     same database — made "a page visit did not cause the record to fill"
 *     appear while the product worked exactly as designed. Deleting the row
 *     clears the lease and the counters together.
 *   - `funder_awards`. The counts below are counts of THIS stub's corpus. A
 *     corpus left by a different one made eight assertions fail with numbers
 *     that were perfectly correct about somebody else's fixtures.
 *
 * Funders left with no awards go too, but only where nothing points at them:
 * an opportunity somebody's application is attached to keeps its funder.
 * Tenant rows are not touched at all — each run signs up a new account, so
 * they are inert, and deleting an organisation's work is not this script's
 * business even in a scratch database.
 */
async function resetDatabase(connectionString) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM admin_sessions');
    await client.query('DELETE FROM admin_accounts');
    await client.query('DELETE FROM corpus_load');
    await client.query('DELETE FROM funder_awards');
    await client.query(
      `DELETE FROM funders f
        WHERE NOT EXISTS (SELECT 1 FROM opportunities o WHERE o.funder_id = f.id)`,
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * Start the server this run will talk to, and wait for it to be able to
 * answer about the database.
 *
 * `/api/health` rather than any 200: a Next server accepts connections before
 * it can reach Postgres, and a run that starts against a server in that state
 * fails in the first block for a reason that has nothing to do with the code.
 */
async function startServer(env) {
  // ITS OWN PROCESS GROUP, so it can be killed as one.
  //
  // `npx next start` is a wrapper around a wrapper: killing the child kills
  // `npx` and leaves `next-server` holding the port. The second consecutive
  // run of this script found that out the hard way — it spawned a server that
  // could not bind, then health-checked the ORPHAN from the run before,
  // signed in against its claim secret rather than its own, and reported four
  // failures about the admin console. A server that answers is not the server
  // you started.
  const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    env: { ...process.env, ...env, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const log = [];
  server.stdout.on('data', (d) => log.push(String(d)));
  server.stderr.on('data', (d) => log.push(String(d)));
  server.log = log;

  const deadline = Date.now() + 90_000;
  for (;;) {
    if (Date.now() > deadline) {
      stopServer(server);
      throw new Error(`the server never became healthy:\n${log.join('').slice(-2000)}`);
    }
    try {
      const health = await (await fetch(`${B}/api/health`)).json();
      if (health.database === 'ok') return server;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Stop the server AND its children — see the note in `startServer`. */
function stopServer(server) {
  if (server === null || server.pid === undefined) return;
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    // Already gone, or never grouped. Fall back to the child itself.
    server.kill();
  }
}

/**
 * Whether anything is already answering on the port we are about to take.
 *
 * Checked BEFORE starting, because the failure it prevents is silent: a stale
 * server from an earlier run holds the port, the new one cannot bind, and the
 * health check passes against the wrong process.
 */
async function portIsBusy() {
  try {
    await fetch(`${B}/api/health`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

let server = null;
if (OWN_SERVER) {
  const connectionString = process.env['DATABASE_URL'] ?? '';
  if (connectionString === '') {
    console.error(
      'DATABASE_URL is not set. This walk needs a real Postgres — the corpus, the lease\n' +
        'and the isolation it asserts are all database behaviour.',
    );
    api.close();
    process.exit(2);
  }
  if (!isLocal(connectionString)) {
    console.error(
      'DATABASE_URL does not point at this machine, and this script resets three tables\n' +
        'before it runs. Point it at a local Postgres, or set BASE_URL to run against a\n' +
        'deployment without touching anything.',
    );
    api.close();
    process.exit(2);
  }
  if (!existsSync('.next')) {
    console.error('No .next build found. Run `npm run build` first — this walks the real build.');
    api.close();
    process.exit(2);
  }

  if (await portIsBusy()) {
    console.error(
      `Something is already answering on ${B}. This walk starts its own server so that the\n` +
        'build under test is the build you just made — it will not run against a process it\n' +
        'does not own. Stop it, or set E2E_PORT to a free port.',
    );
    api.close();
    process.exit(2);
  }

  await resetDatabase(connectionString);
  console.log(`reset the corpus, the lease and the console account · serving on :${PORT}`);
  server = await startServer({
    // ITS OWN STUB, set here rather than hoped for in the environment. A
    // server on the right port pointed at the wrong publisher answers every
    // request and tests nothing.
    THREESIXTYGIVING_BASE_URL: `http://127.0.0.1:${API_PORT}/api/v1/`,
    ADMIN_CLAIM_SECRET: CLAIM_SECRET,
    PORT: String(PORT),
    // Mail through the real Resend adapter, into the stub inbox above.
    RESEND_API_KEY: 're_e2e_stub_not_a_real_key',
    RESEND_BASE_URL: `http://127.0.0.1:${MAIL_PORT}`,
    MAIL_FROM: 'Grant Finder Studio <noreply@example.org>',
    APP_URL: B,
  });
} else {
  console.log(`using the server at ${B} — not touching its database or its processes`);
}

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

/** The reset reply with its address taken out, so two replies can be compared. */
const resetWording = (text, address) =>
  /If (\S+) has an account, a link to choose a new password is on its way/u.exec(text)?.[0]?.replace(address, 'X');

try {
  // --- the applicant --------------------------------------------------------
  const page = await browser.newPage();
  // WITH THE URL. A bare message cost a whole run: a React hydration error
  // came back as eleven words about a minified error code with no way to tell
  // which of forty pages it was on, and the only way to narrow it was to run
  // the walk again and watch.
  page.on('pageerror', (e) => fail(`client exception at ${page.url()}: ${e.message}`));
  // The script policy (src/app/csp.ts) refuses anything without this
  // request's nonce. A refusal is a script the product meant to run and the
  // browser would not — a broken page, or a new inline script nobody nonced.
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy/iu.test(message.text())) {
      fail(`a script policy violation at ${page.url()}: ${message.text().slice(0, 200)}`);
    }
  });

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

  // --- a forgotten password ---------------------------------------------------
  //
  // Its own account in its own browser contexts, because a reset ends every
  // session the account has — done with the main account, it would sign the
  // rest of this walk out.
  if (OWN_SERVER) {
    const resetEmail = `e2e-reset-${Date.now()}@example.org`;
    const oldPassword = 'the-first-passphrase-11';
    const newPassword = 'a-second-longer-passphrase-12';
    const here = await browser.newContext();
    const elsewhere = await browser.newContext();
    const tab = await here.newPage();
    tab.on('pageerror', (e) => fail(`client exception at ${tab.url()}: ${e.message}`));
    const other = await elsewhere.newPage();

    for (const p of [tab, other]) {
      await p.goto(`${B}/${p === tab ? 'sign-up' : 'sign-in'}`, { waitUntil: 'domcontentloaded' });
      await p.fill('input[type="email"]', resetEmail);
      await p.fill('input[type="password"]', oldPassword);
      await p.click('button[type="submit"]');
      await p.waitForLoadState('networkidle');
    }
    // /organisation, not /onboarding: onboarding renders for anybody, so it
    // cannot tell a live session from a dead one. This page sends a live one
    // with no organisation to onboarding, and no session at all to sign-in.
    await other.goto(`${B}/organisation`, { waitUntil: 'networkidle' });
    if (new URL(other.url()).pathname !== '/onboarding') {
      fail(`the reset account is not signed in from a second browser: ${other.url()}`);
    }
    // Signed out of THIS browser, so the reset starts where a real one does.
    await here.clearCookies();

    await tab.goto(`${B}/sign-in`, { waitUntil: 'domcontentloaded' });
    await tab.getByRole('link', { name: /Forgot your password/iu }).click();
    await tab.waitForLoadState('domcontentloaded');
    if (new URL(tab.url()).pathname !== '/forgot-password') {
      fail(`"Forgot your password?" went to ${tab.url()}`);
    } else ok('sign-in offers a way back in for a forgotten password');

    const ask = async (address) => {
      await tab.goto(`${B}/forgot-password`, { waitUntil: 'domcontentloaded' });
      await tab.fill('input[type="email"]', address);
      await tab.click('button[type="submit"]');
      await tab.getByRole('status').waitFor({ timeout: 10_000 }).catch(() => undefined);
      return (await tab.locator('main, body').first().innerText()).replace(/\s+/gu, ' ');
    };
    const nobody = `e2e-nobody-${Date.now()}@example.org`;
    const saidToNobody = await ask(nobody);
    const saidToSomebody = await ask(resetEmail);
    if (resetWording(saidToNobody, nobody) === undefined || resetWording(saidToNobody, nobody) !== resetWording(saidToSomebody, resetEmail)) {
      fail(`the reply differs between an address with an account and one without: "${saidToNobody.slice(0, 200)}" / "${saidToSomebody.slice(0, 200)}"`);
    } else ok('the reply is word for word the same whether or not the address has an account');

    let letter;
    for (let i = 0; i < 20 && letter === undefined; i += 1) {
      letter = outbox.find((m) => m.to?.[0] === resetEmail);
      if (letter === undefined) await tab.waitForTimeout(500);
    }
    if (outbox.some((m) => m.to?.[0] === nobody)) {
      fail('an email went to an address with no account');
    } else ok('and no email goes to an address with no account');

    const link = /https?:\/\/\S+\/reset-password#token=[A-Za-z0-9_-]{43}/u.exec(letter?.text ?? '')?.[0];
    if (letter === undefined || link === undefined) {
      fail(`no reset email with a link arrived: ${JSON.stringify(outbox).slice(0, 300)}`);
    } else {
      ok('the reset email arrives through the Resend adapter, with a link in it');
      if (new URL(link).origin !== new URL(B).origin) {
        fail(`the link is built on ${new URL(link).origin}, not the configured address`);
      } else ok('built on the configured address, not the request\'s Host');

      await tab.goto(link, { waitUntil: 'networkidle' });
      if (new URL(tab.url()).hash !== '') {
        fail(`the token is still in the address bar: ${tab.url()}`);
      } else ok('the token is wiped from the address bar as soon as it is read');

      // Too short first: refused, and the link must survive the refusal.
      await tab.fill('input[type="password"]', 'short');
      await tab.click('button[type="submit"]');
      await tab.waitForLoadState('networkidle');
      await tab.waitForTimeout(500);
      const refusedText = await tab.locator('body').innerText();
      if (!/at least 10 characters/iu.test(refusedText)) {
        fail(`a too-short password was not refused: ${refusedText.slice(0, 300)}`);
      } else ok('a too-short new password is refused with the rule');

      await tab.fill('input[type="password"]', newPassword);
      await tab.click('button[type="submit"]');
      await tab.waitForURL(/\/sign-in/u, { timeout: 15_000 }).catch(() => undefined);
      const done = await tab.locator('body').innerText();
      if (!/Your password has been changed/u.test(done)) {
        fail(`the reset did not land on sign-in with a notice: ${tab.url()} ${done.slice(0, 300)}`);
      } else ok('the refusal kept the link, and the new password saves and says so');

      await other.goto(`${B}/organisation`, { waitUntil: 'networkidle' });
      if (new URL(other.url()).pathname !== '/sign-in') {
        fail(`the other browser is still signed in after the reset, at ${other.url()}`);
      } else ok('and every other session for the account has ended');

      const signInWith = async (secret) => {
        await tab.goto(`${B}/sign-in`, { waitUntil: 'domcontentloaded' });
        await tab.fill('input[type="email"]', resetEmail);
        await tab.fill('input[type="password"]', secret);
        await tab.click('button[type="submit"]');
        await tab.waitForLoadState('networkidle');
        await tab.waitForTimeout(300);
        return new URL(tab.url()).pathname;
      };
      if ((await signInWith(oldPassword)) !== '/sign-in') {
        fail('the old password still signs in');
      } else ok('the old password no longer signs in');
      if ((await signInWith(newPassword)) === '/sign-in') {
        fail('the new password does not sign in');
      } else ok('the new one does');

      await here.clearCookies();
      await tab.goto(link, { waitUntil: 'networkidle' });
      await tab.fill('input[type="password"]', 'yet-another-passphrase-13');
      await tab.click('button[type="submit"]');
      await tab.waitForLoadState('networkidle');
      await tab.waitForTimeout(500);
      if (!/expired or has already been used/iu.test(await tab.locator('body').innerText())) {
        fail('a used reset link worked a second time');
      } else ok('and the link does not work twice');
    }
    await here.close();
    await elsewhere.close();
  }

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
  const secret = OWN_SERVER ? CLAIM_SECRET : (process.env.ADMIN_CLAIM_SECRET ?? '');
  if (secret === '') {
    fail(
      'ADMIN_CLAIM_SECRET is not set, and this run does not own the server, so the first ' +
        'admin cannot be claimed.',
    );
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

  /**
   * WAIT FOR THE CORPUS TO SETTLE BEFORE SEARCHING IT.
   *
   * The step above starts a load, and a load CHAINS: a step with more to do
   * asks for the next one. So without this, everything below searches a table
   * that is still being written to, and two things go wrong.
   *
   * The counts move mid-walk — a search read 49 in one view and 51 in the
   * other, which looked exactly like the two views disagreeing and took a
   * while to rule out.
   *
   * And /grants is `force-dynamic` over data that is changing, which produced
   * an intermittent React #418: the HTML and the payload the client
   * reconciles against were rendered either side of a write. Three sightings,
   * all inside a load; none in ~130 navigations on a settled corpus. React
   * recovers by re-rendering, so nothing a user sees fails — but a walk that
   * fails one run in three is a walk nobody believes, and the race is the
   * rig's rather than the product's. Recorded on the roadmap with the page
   * named, which is what the URL in the pageerror handler is for.
   */
  {
    const settled = async () => {
      const r = await fetch(`${B}/api/corpus`).then((x) => x.json()).catch(() => null);
      return r === null ? true : r.loading !== true;
    };
    const until = Date.now() + 120_000;
    while (!(await settled()) && Date.now() < until) {
      await page.waitForTimeout(1500);
    }
    if (await settled()) ok('the corpus finished loading before anything searched it');
    else fail('the corpus was still loading after two minutes');
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

  // A funder with no website used to end the trail: a sentence saying to go
  // and search for them, with no link. The stub funders publish no website,
  // which is exactly that case.
  await page.goto(`${B}/grants?q=1&text=somerset`, { waitUntil: 'networkidle' });
  const searchLinks = page.locator('a[href^="https://duckduckgo.com/?q="]');
  if ((await searchLinks.count()) === 0) {
    fail('a funder with no website offers no way to find their page');
  } else {
    const href = await searchLinks.first().getAttribute('href');
    const query = new URL(href).searchParams.get('q') ?? '';
    if (!/^"Stub Trust \d" grants how to apply$/u.test(query)) fail(`the search asks the wrong thing: ${query}`);
    else ok('a funder with no website offers a search for their funding page');
    const rel = await searchLinks.first().getAttribute('rel');
    if (!/noreferrer/u.test(rel ?? '')) fail('the search link tells the search engine where it came from');
    else ok('and sends no referrer with it');
  }
  // The stub ids only LOOK like charity numbers, so no register link.
  if (await page.locator('a[href^="https://findthatcharity.uk/"]').count()) {
    fail('a register link was offered for an identifier that is not a register number');
  } else ok('and no register link for an identifier it cannot vouch for');
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
  /**
   * A FUNDER ROW WITH TOO FEW GRANTS TO SUMMARISE STILL NAMES THEM.
   *
   * A walk found fourteen rows reading "1 grant like yours · gave within the
   * last year", nine of them identical, and not one amount on the screen —
   * because a precise search matches one or two grants per funder, so
   * `canCharacterise` declined and nothing replaced it. The module's own doc
   * comment already said the figures should be "given as what they are: a
   * couple of grants, named, not a pattern".
   */
  if (!/£[0-9,]+/u.test(funderView)) {
    fail('no funder row names an amount');
  } else ok('a funder row names what it gave, even below the summary bar');

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

  // --- who got them ---------------------------------------------------------
  //
  // Asked for: "search via similar CICs and see the past grants they've been
  // awarded." A peer's funder list is a plan in a way a funder's grant list is
  // not — it names the next approaches to make.
  await page.goto(`${B}/grants?q=1&text=youth&view=peers`, { waitUntil: 'networkidle' });
  const peers = await page.locator('body').innerText();
  if (!/organisations? received/iu.test(peers)) {
    fail('the by-recipient view does not say what it is showing');
  } else ok('the search can be grouped by who received the grants');
  const peerCards = await page.locator('.peer').all();
  if (peerCards.length === 0) fail('no organisations in the by-recipient view');
  else ok(`${peerCards.length} organisation${peerCards.length === 1 ? '' : 's'} grouped`);
  // The funder names are the actionable part. A row without them is a row
  // that tells a CIC who else got funded and not who to ask.
  if (!/Funded by/iu.test(peers)) fail('a peer row does not name who funded them');
  else ok('and each names the funders who backed them');
  if (!/Closest to your size first/iu.test(peers)) {
    fail('the peer view does not say how it is ordered');
  } else ok('and says how the list is ordered');
  // NO SIZE CLAIM BEFORE THE APPLICANT HAS NAMED A SIZE.
  //
  // The project is created further down this walk, so at this point nothing
  // has been asked for — and a row claiming a grant is "about your size" when
  // we do not know your size would be an invention. The comparison appears
  // once there is something to compare with, asserted below.
  if (/about your size|a different scale|nothing like your ask/iu.test(peers)) {
    fail('a peer row compares its size with an ask nobody has named yet');
  } else ok('and claims no size comparison before an ask exists');
  if (!/Wells Youth Collective/u.test(peers)) {
    fail(`the recipient of the stub's grants is not named: ${peers.slice(0, 200)}`);
  } else ok('and names the organisation itself');
  // Three views, and the choice is in the URL like every other choice here.
  if (!page.url().includes('view=peers')) fail('the view is not in the URL');
  else ok('the third view is in the URL too');

  // --- a word that matches nothing says so ----------------------------------
  //
  // The most useful thing a search can tell you and the one thing it never
  // did. A user searched "community tree nursery somerset" against a record
  // holding no nurseries, got 47% of everything back, and had no way to see
  // that their most specific word was the one doing nothing — so the breadth
  // read as a broken search rather than as a gap in the record.
  await page.goto(`${B}/grants?q=1&text=youth+unicorn&view=grants`, { waitUntil: 'networkidle' });
  const gap = await page.locator('body').innerText();
  if (!/No grant we hold mentions/iu.test(gap)) {
    fail('a word matching nothing is not reported');
  } else ok('a word that matches nothing is named');
  if (!/unicorn/iu.test(gap)) fail('the unmatched word is not named');
  else ok('and it is named, not just counted');
  // And it must not empty the search: the other word still works.
  if (!/Riverside youth skills programme/.test(gap)) {
    fail('one dud word emptied the whole search');
  } else ok('and the rest of the search still runs');
  // A search where everything matches must NOT show the notice.
  await page.goto(`${B}/grants?q=1&text=youth&view=grants`, { waitUntil: 'networkidle' });
  if (/No grant we hold mentions/iu.test(await page.locator('body').innerText())) {
    fail('the unmatched-word notice shows when every word matched');
  } else ok('and stays out of the way when every word matched something');

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
  // --- what we do: asked straight after who we are ---------------------------
  //
  // Setup used to go from legal identity to the project, and confirmed five
  // facts on the way — name, form, number, date and area. That met the
  // Writer's five-fact gate with nothing about the work at all.
  const workReady = await reachField(page, 'mission');
  if (!workReady) {
    fail('onboarding did not ask what the organisation does after the profile was saved');
  } else {
    ok('onboarding asks what the organisation does, straight after who it is');
    const heading = await page.locator('h1').first().innerText();
    if (!/what do you do/i.test(heading)) fail(`the work stage is headed "${heading}"`);
    else ok('the page is headed with the question');

    // Before answering: the facts page must not be satisfied by five facts
    // that are all legal identity.
    await page.goto(`${B}/organisation`, { waitUntil: 'networkidle' });
    const before = await page.locator('body').innerText();
    if (!/Nothing yet about your work/i.test(before)) {
      fail('the facts page is satisfied by legal identity alone');
    } else ok('the facts page says nothing is known about the work yet');
    if (!/Worth having because/i.test(before)) fail('no reason is given for a suggested fact');
    else ok('each suggested fact says why it matters');
    // And the prompt has to arrive at a form already asking that question.
    await page.locator('.fact a', { hasText: /Tell us/i }).first().click();
    await page.waitForLoadState('networkidle');
    const chosen = await page.locator('select[name="claim"]').inputValue();
    if (chosen !== 'mission') fail(`the first prompt opened the form on "${chosen}"`);
    else ok('the first prompt opens the form already asking what you do');
    await page.goto(`${B}/`, { waitUntil: 'networkidle' });
    const guide = await page.locator('.setup-hero').first().innerText();
    if (!/about your work/i.test(guide)) fail(`after the profile the next step is "${guide}"`);
    else ok('the next step after the profile is the work');

    await reachField(page, 'mission');
    await page.fill('textarea[name="mission"]', 'We run practical skills and volunteering days for young people in Wells.');
    await page.fill('textarea[name="beneficiary_groups"]', 'Young people aged 14 to 19 in Somerset.');
    await page.fill('textarea[name="people_supported_last_year"]', 'About 60, across eight courses.');
    await page
      .locator('form', { has: page.locator('textarea[name="mission"]') })
      .locator('button[type="submit"]')
      .click();
  }

  // Same helper: the project step is a collapsed <details> until the work
  // has saved, and polling for visibility alone never opened it.
  const projectReady = await reachField(page, 'projectName');
  if (!projectReady) {
    fail('onboarding did not move on to the project after the work was saved');
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
  await page.goto(`${B}/organisation`, { waitUntil: 'networkidle' });
  const facts = await page.locator('body').innerText();
  if (/Nothing yet about your work|more things? about your work/i.test(facts)) {
    fail('the facts page still asks about the work after it was answered');
  } else ok('the answers about the work are held');
  for (const answer of ['practical skills and volunteering', 'aged 14 to 19', 'About 60']) {
    if (!facts.includes(answer)) fail(`the answer "${answer}" is not among the facts`);
  }
  // Typed by the person, so confirmed as they are typed — never a pile to
  // check afterwards.
  if (/\d+ to check/i.test(facts)) fail('the answers arrived unconfirmed');
  else ok('the answers arrive confirmed');

  // The guided journey used to lead with "Add a fund you are considering",
  // with finding one a small underlined link — for a person who came to FIND
  // funding and has none. Finding is the button now.
  await page.goto(`${B}/`, { waitUntil: 'networkidle' });
  // The NEXT-step card, not the whole page: "See all 5 steps" lists every
  // step's title.
  const nextStep = await page.locator('.setup-hero').first().innerText();
  if (!/Find a fund/i.test(nextStep)) {
    fail(`with the organisation, work and project done, the next step is "${nextStep}"`);
  } else {
    ok('the next step is finding a fund');
    const go = await page.locator('.setup-go').first().getAttribute('href');
    if (go !== '/funders') fail(`the step's button goes to ${go}, not /funders`);
    else ok('the step\'s button is "see who funds work like yours"');
    const add = await page.locator('.setup-alternative a').first().getAttribute('href');
    if (add !== '/opportunities/add') fail('the step offers no way to add a fund already in mind');
    else ok('adding a fund already in mind is the second route');
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
    const fundUrl = page.url();
    if (!(await page.locator('a[href^="https://duckduckgo.com/?q="]').count())) {
      fail('a fund with no link, from a funder with no website, leaves no way to check it');
    } else ok('a fund with no link offers a search for the funder’s page');

    // --- rules for a fund typed in by hand ---------------------------------
    //
    // A typed fund had no rules and no way to get any, so its eligibility
    // could only ever read "we cannot yet tell" — without an API key, the
    // product's middle step was mostly unavailable.
    const bare = await page.locator('body').innerText();
    if (!/no eligibility rules yet/i.test(bare)) fail('a typed fund with no rules does not say so');
    else ok('a typed fund with no rules says so');
    const addRules = page.locator('a', { hasText: /Add their rules/i }).first();
    if (!(await addRules.count())) fail('no way to add rules to a typed fund');
    else {
      await addRules.click();
      await page.waitForLoadState('networkidle');
      const addRule = async (kind, fill) => {
        await page.selectOption('select[name="kind"]', kind);
        await fill();
        await page.locator('button', { hasText: /Add this rule/i }).click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1200);
      };
      // One the e2e organisation meets (it is in Somerset) and one it cannot
      // (incorporated in 2021), so the verdict has to move both ways.
      await addRule('region', () => page.fill('input[name="regions"]', 'Somerset, Devon'));
      await addRule('organisation_age', () => page.fill('input[name="minYears"]', '10'));
      const edit = await page.locator('body').innerText();
      if (!/Only in Somerset and Devon/.test(edit) || !/Existing for at least 10 years/.test(edit)) {
        fail(`the typed rules are not listed: ${edit.slice(0, 300)}`);
      } else ok('rules typed from the guidance are listed on the fund');

      // A rule with no terms is refused, not stored.
      await page.selectOption('select[name="kind"]', 'amount');
      await page.locator('button', { hasText: /Add this rule/i }).click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(800);
      if (!/a range with neither is not a rule/i.test(await page.locator('body').innerText())) {
        fail('an amount rule with no amounts was not refused');
      } else ok('a rule with no terms is refused and says why');

      await page.goto(fundUrl, { waitUntil: 'networkidle' });
      const judged = await page.locator('body').innerText();
      if (!/Somerset is within the funder/.test(judged)) fail('the typed area rule was not applied');
      else ok('the typed area rule is checked, and passes');
      if (!/You are not eligible for this fund/.test(judged)) {
        fail('a typed rule the organisation fails did not make it ineligible');
      } else ok('a typed rule the organisation fails makes the fund ineligible');

      await page.goto(fundUrl + '/edit', { waitUntil: 'networkidle' });
      await page
        .locator('li.rule-in-use', { hasText: /10 years/ })
        .locator('button', { hasText: /Stop using this/i })
        .click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1200);
      await page.goto(fundUrl, { waitUntil: 'networkidle' });
      if (/You are not eligible for this fund/.test(await page.locator('body').innerText())) {
        fail('taking a rule out of use did not change the verdict');
      } else ok('taking a rule out of use changes the verdict back');

      // --- and the fund's own details can be corrected --------------------
      await page.goto(fundUrl + '/edit', { waitUntil: 'networkidle' });
      await page.locator('#details summary').click();
      const title = page.locator('#details input[name="title"]');
      if ((await title.inputValue()) !== 'Community Grants Programme') {
        fail('the details form does not open on the fund as it is');
      } else ok('the details form opens on the fund as it is');
      await title.fill('Community Grants Programme 2027');
      await page.locator('#details button', { hasText: /Save changes/i }).click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1200);
      await page.goto(fundUrl, { waitUntil: 'networkidle' });
      if (!/Community Grants Programme 2027/.test(await page.locator('h1').innerText())) {
        fail('a corrected title did not take');
      } else ok('a typed fund can be corrected');

      // Back to no rules. The readiness checks further down are about a fund
      // with nothing published on who may apply, and they stay about that.
      await page.goto(fundUrl + '/edit', { waitUntil: 'networkidle' });
      await page
        .locator('li.rule-in-use', { hasText: /Somerset/ })
        .locator('button', { hasText: /Stop using this/i })
        .click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1200);
      if (!/No rules yet/.test(await page.locator('#rules').innerText())) {
        fail('the last rule would not come out of use');
      } else ok('and every rule can be taken out again');
    }

    // --- and a fund added by mistake can be removed ------------------------
    await page.goto(`${B}/opportunities/add`, { waitUntil: 'networkidle' });
    await page.fill('input[name="funderName"]', 'Stub Trust 1');
    await page.fill('input[name="title"]', 'A fund added by mistake');
    await page.locator('button').filter({ hasText: /Add this fund/iu }).first().click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1200);
    const openIt = page.locator('a', { hasText: /Open it/i }).first();
    if (!(await openIt.count())) fail('adding a second fund offered no way to it');
    else {
      await openIt.click();
      await page.waitForLoadState('networkidle');
      await page.goto(page.url() + '/edit', { waitUntil: 'networkidle' });
      await page.locator('#remove summary').click();
      await page.locator('#remove button', { hasText: /Remove the fund/i }).click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1200);
      await page.goto(`${B}/`, { waitUntil: 'networkidle' });
      if (/A fund added by mistake/.test(await page.locator('body').innerText())) {
        fail('a removed fund is still on the list');
      } else ok('a fund added by mistake can be removed');
    }
    await page.goto(fundUrl, { waitUntil: 'networkidle' });

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

      // --- the application as a Word document ------------------------------
      //
      // Fetched from inside the page, because Playwright's request context
      // does not carry the session cookie.
      const docx = await page.evaluate(async () => {
        const id = location.pathname.split('/').at(-1);
        const response = await fetch(`/api/applications/${id}/docx`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        return {
          status: response.status,
          type: response.headers.get('content-type') ?? '',
          disposition: response.headers.get('content-disposition') ?? '',
          zip: bytes[0] === 0x50 && bytes[1] === 0x4b,
          size: bytes.length,
        };
      });
      if (docx.status !== 200 || !/wordprocessingml/u.test(docx.type) || !docx.zip) {
        fail(`the Word download did not arrive: ${JSON.stringify(docx)}`);
      } else if (!/attachment; filename="[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.docx"/u.test(docx.disposition)) {
        fail(`the Word download is not named for the fund and the date: ${docx.disposition}`);
      } else ok(`the application downloads as a Word document (${docx.size} bytes)`);

      // --- removing the fund would take this application with it ------------
      //
      // Applications cascade from their fund, and the answers are the
      // person's own writing. The form asks for a tick; the server must
      // refuse without one, so the tick is taken off and the form sent.
      const appUrl = page.url();
      await page.goto(fundUrl + '/edit', { waitUntil: 'networkidle' });
      await page.locator('#remove summary').click();
      const warning = await page.locator('#remove').innerText();
      if (!/your application for it goes too/i.test(warning) || !/1 of 2 questions answered/.test(warning)) {
        fail(`removing a fund with an application does not say what goes: ${warning.slice(0, 200)}`);
      } else ok('removing a fund says its application, and how far along, goes too');
      await page.locator('#remove input[name="alsoApplication"]').evaluate((el) => {
        el.required = false;
      });
      await page.locator('#remove button', { hasText: /Remove the fund/i }).click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1200);
      await page.goto(appUrl, { waitUntil: 'networkidle' });
      if (!/young people aged 14 to 19/u.test(await page.locator('textarea[name="content"]').first().inputValue())) {
        fail('the server removed a fund and its application without the tick');
      } else ok('without the tick, the server keeps the fund and the application');

      // --- the budget ------------------------------------------------------
      //
      // `budgets`, `budget_lines` and `outcomes` were in the schema from 0001
      // with nothing writing to them, while the readiness card said "No
      // budget has been built" and scored the application down for it.
      // Read from the figure itself: the title no longer repeats it.
      const readiness = () =>
        page
          .locator('[data-readiness]')
          .first()
          .getAttribute('data-readiness')
          .then((value) => Number(value ?? '-1'));
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

      // --- and now the peer view HAS something to compare with --------------
      //
      // The project above asks for £18,000. Ordering the peer list by total
      // raised — which is what it did — put a body that had raised £2.9m,
      // "typically £487,710", at the top of a screen headed "organisations
      // like yours". Sorting by total sorts by SIZE, which is the opposite of
      // the question, so every ordering key is on the row in words.
      // Away and back: everything after this checks the application page, and
      // leaving the walk somewhere else cost a run — "the application has no
      // history panel", reported from the grant search.
      const applicationUrl = page.url();
      await page.goto(`${B}/grants?q=1&text=youth&view=peers`, { waitUntil: 'networkidle' });
      const sized = await page.locator('body').innerText();
      if (!/about your size|a different scale|nothing like your ask/iu.test(sized)) {
        fail(`a peer row does not compare its size with the £18,000 ask: ${
          /[^\n]*grants? ·[^\n]*/u.exec(sized)?.[0] ?? '(no peer row found)'
        }`);
      } else ok('a peer row says how its size compares with what you asked for');
      await page.goto(applicationUrl, { waitUntil: 'networkidle' });

      // --- the audit trail --------------------------------------------------
      //
      // `audit_logs` was the last table 0001 created with nothing writing to
      // it, and it is the table that has to prove a reviewer's access was
      // lawful before Phase 9 Step 2 can share anything. Everything above this
      // point in the walk — starting the application, pasting the questions,
      // saving an answer, three budget lines, two outcomes — should be on it.
      const trail = page.locator('details', { has: page.locator('.trail') }).first();
      if ((await trail.count()) === 0) fail('the application has no history panel');
      else {
        ok('the application carries a history of itself');
        await trail.locator('summary').first().click();
        await page.waitForTimeout(400);
        const lines = await page.locator('.trail-line').all();
        if (lines.length < 6) {
          fail(`the trail has ${lines.length} lines for a walk that did at least six things`);
        } else ok(`the trail recorded ${lines.length} changes`);

        const what = await page.locator('.trail-what').allTextContents();
        const expected = ['Application started', 'Questions added', 'Answer written',
          'Budget line added', 'Outcome added'];
        const absent = expected.filter((w) => !what.some((x) => x.includes(w)));
        if (absent.length > 0) fail(`the trail never recorded: ${absent.join(', ')}`);
        else ok('and names each kind of change in words rather than slugs');

        // No slugs. A trail rendering `budget_line.added` is a log file.
        const slugs = what.filter((x) => /[a-z]+[._][a-z]/u.test(x));
        if (slugs.length > 0) fail(`the trail is showing slugs: ${slugs.join(', ')}`);
        else ok('and no line is a raw action name');

        // NEWEST FIRST, checked against what the walk did last: the outcomes
        // came after the budget, which came after the answer.
        const first = what[0] ?? '';
        if (!/Outcome added/u.test(first)) {
          fail(`the newest line is not the last thing done: "${first}"`);
        } else ok('newest first, so the last thing done is at the top');

        // THE ACTOR IS ABSENT HERE, ON PURPOSE.
        //
        // One person has touched this application, so "by you" on every line
        // would be the page telling a sole director who they are — the first
        // screenshot was five lines each ending in it. It appears when the
        // trail has more than one actor, which this walk has no second user to
        // produce; that case is covered in `TrailPanel`'s own reasoning and by
        // `audit.test.ts` recording two distinct actors.
        const actors = await page.locator('.trail-who').count();
        if (actors > 0) {
          fail(`the trail names the actor ${actors} times for a single-handed application`);
        } else ok('and does not repeat "by you" when nobody else has been in here');

        // SHAPE, NOT CONTENT. The answer the walk saved is in the trail's
        // application, so its prose is on the page — but it must not be
        // inside a trail line, because copying answer text into `audit_logs`
        // would make a second, unversioned store of the applicant's writing
        // and hand it to whoever the application gets shared with.
        const inTrail = (await trail.innerText()).replace(/\n+/gu, ' ');
        // The budget line's category as the budget panel words it, not as the
        // column stores it: "freelancers" in one place and "Freelancers and
        // contractors" in the other is one record described two ways.
        if (/·\s*[a-z_]+\s*$/mu.test(inTrail)) {
          fail(`the trail is showing a raw category id: ${inTrail.slice(0, 200)}`);
        } else ok('and names a cost category the way the budget panel does');
        if (/young people aged 14 to 19/u.test(inTrail)) {
          fail('the trail is carrying the answer’s prose, not just its shape');
        } else ok('and carries the shape of a change, never the words');
        if (!/\b\d+ words?\b/u.test(inTrail)) {
          fail(`the answer line records no word count: ${inTrail.slice(0, 200)}`);
        } else ok('a saved answer is recorded as a word count');
      }

      // --- the funder answers ------------------------------------------------
      //
      // The walk had never opened /tracker at all, so the one screen that
      // reports what is slipping went unchecked by the only rig that runs a
      // browser. It is checked here because the outcome loop lives on it, and
      // because the decision form is a client component with a conditional
      // field — exactly the kind of thing that type-checks and still does not
      // work. `page.on('pageerror')` above is what makes this a hydration
      // check as well as a behaviour one.
      await page.goto(`${B}/tracker`, { waitUntil: 'networkidle' });
      const trackerText = () => page.locator('body').innerText();
      const beforeSubmit = await trackerText();
      if (/Application error|server-side exception/i.test(beforeSubmit)) {
        fail(`the tracker will not render: ${beforeSubmit.slice(0, 300)}`);
      } else ok('the tracker renders with an application on it');

      if (/Record the funder/iu.test(beforeSubmit)) {
        fail('an unsent application is being asked what the funder said');
      } else ok('an unsent application is not asked what the funder said');

      const markSubmitted = page
        .locator('button')
        .filter({ hasText: /^Mark submitted$/iu })
        .first();
      if (!(await markSubmitted.count())) {
        fail('no way to mark an application submitted from the tracker');
      } else {
        await markSubmitted.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(800);
        const afterSubmit = await trackerText();
        if (!/Record the funder/iu.test(afterSubmit)) {
          fail('a submitted application is never asked what the funder said');
        } else ok('a submitted application is asked what the funder said');

        const disclosure = page
          .locator('summary')
          .filter({ hasText: /Record the funder/iu })
          .first();
        await disclosure.click();
        await page.waitForTimeout(300);

        // THE AMOUNT BOX IS NOT THERE YET. It belongs only on an award, and
        // the server refuses one anywhere else; the form is supposed to spare
        // the person that conversation.
        if (await page.locator('input[name="amountAwardedGbp"]').count()) {
          fail('the amount box is offered before an award is chosen');
        } else ok('the amount box is not offered until the answer is an award');

        const today = new Date().toISOString().slice(0, 10);

        // A DATE FROM THE FUTURE, first, so the refusal is proved before the
        // success. A form that accepts everything passes a happy-path check.
        //
        // The browser gets there before the server does: the input carries
        // `max={today}`, so a future date is a range overflow and the submit
        // never leaves the page. That is the better refusal — immediate, and
        // beside the box — so what is checked here is that it happened and
        // that nothing was recorded, not which layer said so. The server's
        // own rule is the real guard and is proved in
        // `src/domain/tracker/decision.test.ts`.
        const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
        await page.locator('input[value="rejected"]').first().check();
        await page.fill('input[name="decidedOn"]', tomorrow);
        const overflows = await page
          .locator('input[name="decidedOn"]')
          .first()
          .evaluate((el) => el.validity.rangeOverflow);
        if (!overflows) fail('a date after today is not out of the input’s range');
        else ok('a date after today is out of the input’s range');

        await page.locator('button').filter({ hasText: /^Record it$/iu }).first().click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(800);
        const refused = await trackerText();
        if (/\bAnswered\b/u.test(refused)) {
          fail(`an answer dated tomorrow was recorded: ${refused.slice(0, 300)}`);
        } else ok('and an answer dated tomorrow is not recorded');

        await page.locator('input[value="awarded"]').first().check();
        await page.waitForTimeout(200);
        if (!(await page.locator('input[name="amountAwardedGbp"]').count())) {
          fail('choosing an award does not offer the amount box');
        } else ok('choosing an award offers the amount box');

        await page.fill('input[name="decidedOn"]', today);
        await page.fill('input[name="amountAwardedGbp"]', '12,500');
        await page.fill('textarea[name="note"]', 'Funded for year one only.');
        await page.locator('button').filter({ hasText: /^Record it$/iu }).first().click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);

        const answered = await trackerText();
        if (!/\bAnswered\b/u.test(answered)) {
          fail(`a decided application did not move to Answered: ${answered.slice(0, 300)}`);
        } else ok('a decided application moves to its own group');
        if (!/Funded/u.test(answered)) fail('the row does not say it was funded');
        else ok('and the row says it was funded');
        if (!/£12,500/u.test(answered)) fail('the amount awarded is not on the row');
        else ok('and carries the amount actually given');
        if (!/Funded for year one only/u.test(answered)) {
          fail('the funder’s own words were not kept');
        } else ok('and keeps what the funder said, in their words');
        if (!/Too few decided either way/iu.test(answered)) {
          fail(`a success rate was printed over one answer: ${answered.slice(0, 400)}`);
        } else ok('and withholds a success rate over a single answer');

        // Undoing it has to take the money with it. An amount left behind
        // would show up in the next total as money won on an application
        // nobody has heard about.
        await page
          .locator('button')
          .filter({ hasText: /Not answered after all/iu })
          .first()
          .click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(800);
        const undone = await trackerText();
        if (/£12,500/u.test(undone)) {
          fail('withdrawing the answer left the amount behind');
        } else ok('withdrawing the answer takes the amount with it');
        if (!/Record the funder/iu.test(undone)) {
          fail('withdrawing the answer did not put it back to waiting');
        } else ok('and puts the application back to waiting on the funder');
      }

      // --- what we hold, and getting rid of it -------------------------------
      //
      // LAST IN THE WALK, because it ends by deleting the account it has spent
      // the whole run building. That is the point: "delete everything" is the
      // one claim in this product that cannot be half-proved, and the only
      // honest way to check it is to do it and then find the door locked.
      await page.goto(`${B}/privacy`, { waitUntil: 'networkidle' });
      const notice = await page.locator('body').innerText();
      if (/Application error|server-side exception/i.test(notice)) {
        fail(`the privacy notice will not render: ${notice.slice(0, 300)}`);
      } else ok('the privacy notice renders');
      // Generated from the schema, so the real table names are on it. This is
      // what a technical reader checks the page against.
      if (!/application_shares/u.test(notice) || !/document_chunks/u.test(notice)) {
        fail('the notice does not name the real tables it is generated from');
      } else ok('and names the real tables it was generated from');
      if (!/not finished and must not be relied on yet/iu.test(notice)) {
        fail('the notice does not admit that its publisher is unnamed');
      } else ok('and says plainly that it is still a draft');

      // FETCHED FROM INSIDE THE PAGE, not through page.request.
      //
      // A download in a headless browser is a fight with no useful outcome, so
      // the file is fetched instead — but it has to be fetched by the PAGE.
      // `page.request` does not carry the browser's session cookie, so it
      // followed the redirect to /sign-in and handed back HTML with a 200 on
      // it. The run then died inside JSON.parse with a stack trace naming no
      // check at all, which is a worse report than the fault it was finding.
      // Hence a helper that never throws and always says what it got.
      const fetchInPage = async (path) =>
        page.evaluate(async (url) => {
          const response = await fetch(url, { credentials: 'same-origin' });
          return {
            status: response.status,
            type: response.headers.get('content-type') ?? '',
            body: await response.text(),
          };
        }, path);

      const exported = await fetchInPage('/api/account/export');
      if (exported.status !== 200 || !exported.type.includes('json')) {
        fail(
          `the export answered ${exported.status} as ${exported.type || 'nothing'} — ` +
            `${exported.body.slice(0, 120)}`,
        );
      } else {
        let dump = null;
        try {
          dump = JSON.parse(exported.body);
        } catch {
          fail(`the export is not readable JSON: ${exported.body.slice(0, 120)}`);
        }
        if (dump !== null) {
        const tables = Object.keys(dump.data ?? {});
        if (tables.length < 10) {
          fail(`the export carries only ${tables.length} tables`);
        } else ok(`the export carries all ${tables.length} tables`);
        if (!tables.every((name) => dump.legend?.[name]?.label)) {
          fail('a table in the export has no legend, so the file needs our schema to read');
        } else ok('and a legend for every one of them, so it reads without our schema');
        if (JSON.stringify(dump).includes('password')) {
          fail('the export contains something called a password');
        } else ok('and nothing resembling a password');
        if (!(dump.members ?? []).some((m) => String(m.email).includes('@'))) {
          fail('the export names no members');
        } else ok('and names who is in the organisation');
        }
      }

      await page.goto(`${B}/organisation`, { waitUntil: 'networkidle' });
      const eraseSummary = page
        .locator('summary')
        .filter({ hasText: /Delete this organisation/iu })
        .first();
      // OPEN IT ONLY IF IT IS SHUT. Clicking a <summary> toggles, so a second
      // blind click closes the panel and every fill after it waits thirty
      // seconds for an element that is present and invisible.
      const openTheDanger = async () => {
        const details = page.locator('details.danger').first();
        if (!(await details.evaluate((el) => el.open))) {
          await details.locator('summary').first().click();
        }
        await page.waitForTimeout(250);
      };
      if (!(await eraseSummary.count())) fail('there is no way to delete the organisation');
      else {
        await openTheDanger();

        // What it is about to remove, from real counts. A warning in the
        // abstract would not tell somebody which account they are in.
        const dangerText = await page.locator('.danger').first().innerText();
        if (!/This removes .*\d+ .*cannot be undone/su.test(dangerText)) {
          fail(`the delete does not say what it would remove: ${dangerText.slice(0, 200)}`);
        } else ok('the delete says what it is about to remove, counted');

        // WHAT IT ASKS FOR, read off the page rather than assumed. The prompt
        // names either the organisation's name or the fallback word, and
        // which one depends on how far onboarding got.
        const prompt = await page.locator('label[for="erase-confirm"]').first().innerText();
        const named = /—\s*(.+?)\s*—/u.exec(prompt);
        const confirmWord = named?.[1] ?? 'DELETE';
        ok(`and names what to type to confirm it`);

        // A wrong name first. A confirmation that accepts anything is not one.
        await page.fill('#erase-confirm', `${confirmWord} but wrong`);
        await page.locator('button').filter({ hasText: /Delete everything/iu }).first().click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(800);
        const refused = await page.locator('body').innerText();
        if (!/does not match/iu.test(refused)) {
          fail(`a mistyped name did not refuse: ${refused.slice(0, 300)}`);
        } else ok('a name that does not match deletes nothing, and says so');

        const stillThere = await fetchInPage('/api/account/export');
        if (stillThere.status !== 200 || !stillThere.type.includes('json')) {
          fail('the refused delete took the account with it anyway');
        } else ok('and the organisation is still there afterwards');

        // Now for real.
        await openTheDanger();
        await page.fill('#erase-confirm', confirmWord);
        await page.locator('button').filter({ hasText: /Delete everything/iu }).first().click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1200);

        const afterErase = await page.locator('body').innerText();
        if (!/Deleted\./u.test(afterErase)) {
          fail(`the deletion did not say it had happened: ${afterErase.slice(0, 300)}`);
        } else ok('the right name deletes it, and the front door says so');

        // THE DOOR IS LOCKED. Signed out, because the session row went with
        // the user it belonged to.
        await page.goto(`${B}/organisation`, { waitUntil: 'networkidle' });
        const locked = new URL(page.url()).pathname;
        if (locked !== '/sign-in') {
          fail(`the account still opens after deletion, at ${locked}`);
        } else ok('and the account no longer opens');
      }
    }
  }
} catch (error) {
  // A THROW USED TO SKIP THE VERDICT ENTIRELY.
  //
  // Twice today this walk died inside a helper and printed a stack trace
  // instead of its own report, so the run said nothing about the forty checks
  // that had already passed. An exception is a failure like any other and is
  // recorded as one; the verdict below still prints.
  fail(`the walk stopped early: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await browser.close();
  api.close();
  if (mail.listening) mail.close();
  // Ours to stop, group and all. Left running, it holds the port and — worse
  // — serves a build that the next `npm run build` has already replaced.
  stopServer(server);
}

if (failures.length > 0) {
  console.log(`\nE2E: FAILED — ${failures.length} of ${failures.length + passed} checks`);
  for (const [i, message] of failures.entries()) console.log(`  ${i + 1}. ${message}`);
} else {
  console.log(`\nE2E: clean — ${passed} checks`);
}
