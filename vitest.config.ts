import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/domain/**/*.ts'],
      // eligibility/types.ts is type declarations only — no runtime code to cover.
      exclude: [
        'src/domain/**/*.test.ts',
        'src/domain/**/index.ts',
        'src/domain/eligibility/types.ts',
      ],
      thresholds: { branches: 90, functions: 90, lines: 90, statements: 90 },
    },
  },
});
