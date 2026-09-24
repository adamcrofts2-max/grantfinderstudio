/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * The dev server builds somewhere else.
   *
   * `next dev` and `next build` both write `.next` by default, so starting the
   * dev server after a production build CLOBBERS it — and `next start` then
   * serves a half-dev tree. That produced a React hydration error on a page
   * nothing was wrong with, twice, and cost the best part of an hour each
   * time chasing a fault that was not in the product.
   *
   * `npm run dev` sets NEXT_DIST_DIR=.next-dev, so the two cannot collide and
   * a production build stays a production build.
   */
  distDir: process.env['NEXT_DIST_DIR'] ?? '.next',
  // PGlite ships WebAssembly and must not be bundled for the browser.
  // unpdf carries a PDF engine and mammoth a zip reader; both run only on the
  // server, and bundling them pulls an `import.meta` webpack cannot handle.
  serverExternalPackages: ['@electric-sql/pglite', 'unpdf', 'mammoth'],

  /**
   * Server actions default to a 1 MB body, and documents are uploaded through
   * one — so every file over 1 MB failed with a framework error while the page
   * promised 15. 16 MB is the 15 MB ceiling (`UPLOAD_LIMITS.maxBytes`) plus the
   * multipart wrapping around it; `upload-limit.test.ts` holds the two to each
   * other. What a Word file then UNPACKS to is bounded separately, in
   * `src/documents/zip-guard.ts`.
   */
  experimental: {
    serverActions: { bodySizeLimit: '16mb' },
  },

  /**
   * Response headers on every route. Added by the September 2026 security
   * review, which found none at all.
   *
   *  - FRAMING: without these, any site could load this product in a frame
   *    and dress its buttons up as something else. Several are one click —
   *    withdraw a review link, mark something submitted, record an answer —
   *    and one click is all clickjacking needs. `X-Frame-Options` for older
   *    browsers, `frame-ancestors` for current ones.
   *  - NOSNIFF: the export is JSON and the calendar is text/calendar; neither
   *    should ever be guessed into something a browser would run.
   *  - REFERRER: the default policy already sends only the origin across
   *    sites. Stated anyway, so it is a decision rather than a browser
   *    default we happen to inherit.
   *
   * The Content-Security-Policy is NOT here: it needs a nonce per request,
   * so middleware sets it, `frame-ancestors 'none'` included (see
   * `src/app/csp.ts`). One source for it, because a second header with the
   * same name here could replace the full policy with this one line.
   * `X-Frame-Options` still covers framing on the few paths middleware skips.
   */
  async headers() {
    const everywhere = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ];
    return [
      { source: '/:path*', headers: everywhere },
      // LAST, so it wins: when two rules set the same header, Next applies the
      // later one. The review link carries its secret in the PATH, so it
      // sends no referrer at all — not even to our own pages. There is no
      // outbound link on it today; this is so there never needs to be a
      // review of whether a new one leaks the token.
      {
        source: '/review/:path*',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
    ];
  },

  // The source uses ESM-correct '.js' specifiers that point at '.ts' files —
  // the form TypeScript and Vitest expect. Teach the bundler the same mapping
  // rather than rewriting every import to a bundler-specific style.
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
