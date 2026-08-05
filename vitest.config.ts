import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Tests run before any build in CI: resolve the workspace library to its
    // sources instead of dist.
    alias: {
      '@wdf/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@wdf/import': fileURLToPath(new URL('./packages/import/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/test/**/*.spec.ts'],
  },
});
