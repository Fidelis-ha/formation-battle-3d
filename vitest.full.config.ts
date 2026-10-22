import { defineConfig } from 'vitest/config';

/**
 * Vollstaendiger Lauf inklusive der schweren Schlachtsimulationen.
 *
 * Aufruf: `npm run test:full` — dauert rund zwei Minuten.
 */
export default defineConfig({
  test: {
    testTimeout: 300000,
    hookTimeout: 300000,
  },
});
