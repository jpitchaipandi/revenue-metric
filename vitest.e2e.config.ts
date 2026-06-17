import { defineConfig } from 'vitest/config';

/**
 * E2E test config — opt-in. Run with:
 *
 *   SMOKE_URL=https://revenue-metric-api.onrender.com npm run test:e2e
 *
 * The smoke test skips itself if SMOKE_URL is not set.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e/**/*.test.ts'],
    testTimeout: 90_000,
  },
});
