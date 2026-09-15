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
