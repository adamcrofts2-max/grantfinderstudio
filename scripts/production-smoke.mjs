/**
 * Serve the PRODUCTION build against a REAL PostgreSQL and check every route.
 *
 * ## Why this exists
 *
 * Almost every fault found during the first real deployment was invisible to
 * `npm test`, and invisible for the same reason: the test suite runs against
 * PGlite as a superuser, in a dev bundle, with no client/server boundary
 * applied. Three whole classes of bug live in the gap.
 *
 *  - **The bundler.** A `'use server'` module importing a plain value from a
 *    `'use client'` module gets a client-reference proxy, not the value. Adding
 *    a fund by hand threw "fields is not iterable" and could never have worked
 *    in a real build. Vitest imports the array normally, so nothing failed.
 *  - **The database role.** PGlite connects as a superuser, and superusers
 *    bypass Row-Level Security regardless of FORCE. A non-superuser owner —
 *    which is what every managed host gives you — is refused writes the tests
 *    sail through.
 *  - **Rendering.** A server action that invalidates nothing leaves the page it
 *    was called from rendering stale content. Onboarding saved an organisation
 *    and went on offering the search box.
 *
 * So: a real build, a real Postgres, a real HTTP server, and an assertion that
 * nothing 5xxes.
 *
 * ## Running it
 *
 *     # any Postgres will do; a non-superuser owner is the realistic shape
 *     export DATABASE_URL='postgres://owner:pw@127.0.0.1:5433/gfs'
 *     export APP_ENCRYPTION_KEY="$(openssl rand -base64 32)"
 *     npm run build && npm run smoke
 *
 * Set BASE_URL to check a server that is already running (including a
 * deployed one) instead of starting one.
 */

import { spawn } from 'node:child_process';

const OWN_SERVER = process.env['BASE_URL'] === undefined;
const B = process.env['BASE_URL'] ?? 'http://localhost:3000';

/**
 * Every route, and the worst status each may legitimately return.
 *
 * A tenant route with no session REDIRECTS, and a console route without an
 * admin session does too, so the bar is "not a server error" rather than 200.
 * That is the assertion that matters: a 500 here is a page that cannot render.
 */
const ROUTES = [
  '/', '/sign-in', '/sign-up', '/onboarding', '/organisation', '/grants', '/funders',
  '/opportunities/add', '/tracker', '/applications', '/documents',
  '/admin', '/admin/sign-in', '/admin/funders', '/admin/catalogue',
  '/admin/accounts', '/admin/admins', '/admin/sandbox', '/admin/settings',
  '/api/health', '/api/corpus',
];

/**
 * Routes that must REFUSE without a secret.
 *
 * `/api/corpus/step` fetches from somebody else's API and writes to the
 * database. An unauthenticated endpoint that does that is a way to get this
 * deployment blocked, so "it refuses" is a property worth asserting in a real
 * build rather than trusting a unit test of the comparison.
 */
const MUST_REFUSE = ['/api/corpus/step'];

/**
 * One route's status, or null if it never answered.
 *
 * A route that HANGS is a fault as real as a 500 — and without a bound here
 * the harness died on an undici headers timeout with a stack trace that named
 * no route at all, which is a worse report than the fault it was finding.
 */
async function statusOf(route) {
  try {
    const response = await fetch(`${B}${route}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    return response.status;
  } catch {
    return null;
  }
}

let server;
if (OWN_SERVER) {
  if ((process.env['DATABASE_URL'] ?? '') === '') {
    console.error('DATABASE_URL is required: the point of this check is a real Postgres.');
    process.exit(2);
  }
  server = spawn('npm', ['start'], {
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Kept, and printed only on failure: a server-side exception's stack is the
  // whole value of running this, and Next prints it here rather than in the
  // response.
  const log = [];
  server.stdout.on('data', (d) => log.push(String(d)));
  server.stderr.on('data', (d) => log.push(String(d)));
  server.serverLog = log;
}

const reachable = async () => {
  try {
    await fetch(`${B}/api/health`);
    return true;
  } catch {
    return false;
  }
};

const deadline = Date.now() + 90_000;
/* eslint-disable no-await-in-loop */
while (!(await reachable())) {
  if (Date.now() > deadline) {
    console.error('The server never came up.');
    if (server) console.error((server.serverLog ?? []).join('').slice(-4000));
    server?.kill();
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1000));
}

const health = await (await fetch(`${B}/api/health`)).json();
console.log(
  `health: ${health.status} · database ${health.database} · isolation ${health.isolation} · ` +
    `migrations ${health.migrations?.applied}/${health.migrations?.expected}`,
);
for (const problem of health.problems ?? []) {
  console.log(`  [${problem.variable}] ${problem.problem} — ${problem.fix}`);
}

let broken = 0;
for (const route of ROUTES) {
  const status = await statusOf(route);
  // `/api/health` returns 503 when it has something to report, which is the
  // endpoint working rather than failing — a local connection string without
  // sslmode=require trips it every time. Its verdict is asserted on its own
  // below, from the parsed body; counting its status here as well made the
  // whole run un-cleanable locally for a reason that was never about the code.
  const bad = status === null || (status >= 500 && route !== '/api/health');
  if (bad) broken += 1;
  console.log(
    `${route.padEnd(22)} ${status ?? 'TIMEOUT'}${bad ? '  ← SERVER ERROR' : ''}`,
  );
}
for (const route of MUST_REFUSE) {
  const status = await statusOf(route);
  // 401 is right and so is 503 with no database; anything that WORKED is not.
  const open = status !== null && status < 400;
  if (open || status === null) broken += 1;
  console.log(
    `${route.padEnd(22)} ${status ?? 'TIMEOUT'}${
      open ? '  ← OPEN, MUST REQUIRE A SECRET' : status === null ? '' : '  (refused, correctly)'
    }`,
  );
}
/* eslint-enable no-await-in-loop */

if (broken > 0 && server) {
  console.error('\n--- server log ---');
  console.error((server.serverLog ?? []).join('').slice(-6000));
}

server?.kill();
const healthy = health.status === 'ok' && broken === 0;
console.log(`\n${healthy ? 'PRODUCTION SMOKE: clean' : `PRODUCTION SMOKE: ${broken} route(s) failing`}`);
process.exit(healthy ? 0 : 1);
