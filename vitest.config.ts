import angular from '@analogjs/vite-plugin-angular';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Compiles Angular components in specs; plain TypeScript specs pass through untouched.
  plugins: [angular({ tsconfig: 'projects/core/tsconfig.spec.json' })],
  resolve: {
    alias: [
      // Specs of both libraries import the core by its package name, from the sources.
      {
        find: /^@angular-ink\/core$/,
        replacement: fileURLToPath(new URL('./projects/core/src/public-api.ts', import.meta.url)),
      },
    ],
  },
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**'],
    setupFiles: ['projects/core/src/testing/setup.ts'],
    // Spies and stubbed globals never outlive the test that made them.
    restoreMocks: true,
    unstubGlobals: true,
    include: [
      'projects/core/src/**/*.spec.ts',
      'projects/testing/src/**/*.spec.ts',
      'scripts/**/*.spec.mjs',
    ],
    coverage: {
      provider: 'v8',
      include: ['projects/core/src/lib/**/*.ts', 'projects/testing/src/**/*.ts'],
      exclude: ['**/*.spec.ts', '**/*.d.ts'],
      reporter: ['text-summary', 'lcov'],
      // Per-folder gates from docs/ENGINEERING.md.
      thresholds: {
        'projects/core/src/lib/engine/**': { lines: 95, branches: 90 },
        'projects/core/src/lib/tree/**': { lines: 90 },
        'projects/core/src/lib/elements/**': { lines: 90 },
        'projects/core/src/lib/input/**': { lines: 90 },
      },
    },
  },
});
