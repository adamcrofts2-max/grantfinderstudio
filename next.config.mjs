/** @type {import('next').NextConfig} */
const nextConfig = {
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
