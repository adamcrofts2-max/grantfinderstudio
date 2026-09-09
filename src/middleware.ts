import { NextResponse, type NextRequest } from 'next/server';

/**
 * Two small things the layout cannot do for itself.
 *
 * A root layout in the App Router is not told which page it is wrapping, and
 * the console must not be dressed in the customer's shell — its navigation,
 * its setup guide and its funding language all belong to somebody who is not
 * an operator. So the path is forwarded as a header the layout can read.
 *
 * The header is set on every request, overwriting whatever arrived: a client
 * that sent its own `x-pathname` would otherwise choose which chrome it got.
 *
 * Runs on the edge runtime, so it does nothing but rewrite headers. Every
 * decision that needs the database — whether there is an admin session, and
 * whether it is still valid — stays in `requireAdmin`, where it can be made
 * properly.
 */
export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set('x-pathname', request.nextUrl.pathname);

  const response = NextResponse.next({ request: { headers } });

  // A console has no business in a search index. Belt and braces alongside the
  // per-page robots metadata: this covers the routes and any error page they
  // render.
  if (request.nextUrl.pathname.startsWith('/admin')) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return response;
}

export const config = {
  // Everything except Next's own assets, which do not need a header setting on
  // them and are requested constantly.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
