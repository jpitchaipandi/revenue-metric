/**
 * Architectural enforcement at the import-graph level.
 *
 * The ESLint rule in `eslint.config.js` catches the *string* `'collected_revenue_v'`
 * appearing outside permitted modules. This config catches the second
 * dimension: who *imports* the modules that have access to the
 * revenue source of truth.
 *
 *   1. metrics/repository.ts is the only file allowed to import db/client
 *      for revenue queries. Other modules go through metrics/service or
 *      metrics/repository directly — never the raw pool/Drizzle client.
 *      (Ingest modules ARE allowed to use db/client for upserting via
 *      sources/upsert, but they don't query revenue.)
 *
 *   2. Only modules under metrics/ and status/ may import
 *      status/canonical-status — that's where REVENUE_ALLOW_LIST lives.
 *      Other modules that need to know about canonical statuses go
 *      through the mapper or repository.
 *
 * Run via:  npx depcruise -c .dependency-cruiser.cjs src
 * Wired up as `npm run depcruise`.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-canonical-status-import-outside-status-or-metrics',
      severity: 'error',
      comment:
        'REVENUE_ALLOW_LIST and the CanonicalStatus enum live in src/status/canonical-status.ts. ' +
        'They are intentionally accessed only via src/status/ (mappers + mapToCanonical) and ' +
        'src/metrics/ (the canonical revenue computation). Routing anywhere else around them ' +
        'creates a second revenue authority — exactly what this project is designed to prevent.',
      from: {
        path: '^src/',
        pathNot: [
          '^src/status/',
          '^src/metrics/',
          // Type-only import of CanonicalStatus for NormalizedTransaction
          '^src/sources/types\\.ts$',
          // Upsert helper writes canonical_status — the value comes
          // from the mapper, but this module needs the enum constants
          '^src/sources/upsert\\.ts$',
          // Test files assert on canonical statuses — read-only use
          '\\.test\\.ts$',
        ],
      },
      to: {
        path: '^src/status/canonical-status\\.ts$',
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      extensions: ['.ts', '.js', '.json'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
