import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules'],
    testTimeout: 10_000,
    // Run test files serially. Multiple files BEGIN transactions and
    // DELETE FROM transactions against the same Supabase database; in
    // parallel they wait on each other's row locks and time out.
    fileParallelism: false,
  },
});
