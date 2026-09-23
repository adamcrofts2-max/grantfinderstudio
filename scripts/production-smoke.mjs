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
/**
 * Its own port when it starts its own server.
 *
 * Not 3000. A dev server, or a `next start` left over from something else,
 * answers every request here perfectly — and `reachable()` cannot tell that
 * apart from the server this script just spawned, so the whole run would pass
 * against a build nobody meant to test. The e2e hit exactly that twice in one
 * afternoon.
 */
const PORT = Number(process.env['SMOKE_PORT'] ?? 3200);
const B = process.env['BASE_URL'] ?? `http://127.0.0.1:${PORT}`;

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
  // The reviewer's page, with a token nobody issued: a 404 is the right
  // answer and a 500 is the fault worth catching. It is the one route that
  // renders with no session at all, so nothing else here would exercise it.
  '/review/not-a-real-token',
  // Both must render to somebody with no session. A privacy notice reachable
  // only after signing up is useless at the one moment it matters, so a
  // redirect here is a fault and not a detail.
  '/privacy', '/terms',
  '/api/health', '/api/corpus', '/api/corpus/step',
];

/**
 * Routes that must answer 200 signed out, rather than merely not 500.
 *
 * Everything else in ROUTES is allowed to redirect to the sign-in page. These
 * two are the product's public obligations and a 307 would hide them behind
 * the very door they exist to inform people about.
 */
const MUST_BE_PUBLIC = new Set(['/privacy', '/terms']);

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

/**
 * Refuse a port somebody else is already answering on.
 *
 * Checked BEFORE spawning, because the failure it prevents is silent: the new
 * server cannot bind, `reachable()` succeeds against the old one, and every
 * route passes while testing a build nobody meant to test.
 */
async function portIsBusy() {
  try {
    await fetch(`${B}/api/health`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

let server;
if (OWN_SERVER) {
  if ((process.env['DATABASE_URL'] ?? '') === '') {
    console.error('DATABASE_URL is required: the point of this check is a real Postgres.');
    process.exit(2);
  }
  if (await portIsBusy()) {
    console.error(
      `Something is already answering on ${B}. This check starts its own server so that\n` +
        'the build under test is the build you just made. Stop it, or set SMOKE_PORT.',
    );
    process.exit(2);
  }
  server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group: `npx` is a wrapper, and killing it leaves
    // `next-server` holding the port for whatever runs next.
    detached: true,
  });
  // Kept, and printed only on failure: a server-side exception's stack is the
  // whole value of running this, and Next prints it here rather than in the
  // response.
  const log = [];
  server.stdout.on('data', (d) => log.push(String(d)));
  server.stderr.on('data', (d) => log.push(String(d)));
  server.serverLog = log;
}

/** Stop the server and its children. See the note on `detached`. */
function stop(child) {
  if (!child || child.pid === undefined) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill();
  }
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
    stop(server);
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
  const bad =
    status === null ||
    (status >= 500 && route !== '/api/health') ||
    (MUST_BE_PUBLIC.has(route) && status !== 200);
  if (bad) broken += 1;
  console.log(
    `${route.padEnd(22)} ${status ?? 'TIMEOUT'}${bad ? '  ← SERVER ERROR' : ''}`,
  );
}
/* eslint-enable no-await-in-loop */

if (broken > 0 && server) {
  console.error('\n--- server log ---');
  console.error((server.serverLog ?? []).join('').slice(-6000));
}

stop(server);
const healthy = health.status === 'ok' && broken === 0;
console.log(`\n${healthy ? 'PRODUCTION SMOKE: clean' : `PRODUCTION SMOKE: ${broken} route(s) failing`}`);
process.exit(healthy ? 0 : 1);
