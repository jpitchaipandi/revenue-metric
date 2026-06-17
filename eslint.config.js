// @ts-check
import tseslint from 'typescript-eslint';
import js from '@eslint/js';

/**
 * Flat ESLint config (ESLint 9+).
 *
 * The architectural rule that matters here: the string literal
 * `'collected_revenue_v'` may appear ONLY in:
 *   - src/metrics/repository.ts (the canonical query module)
 *   - src/db/schema.ts (Drizzle's pgView() declaration)
 *
 * Anywhere else is a code smell — someone is querying the revenue view
 * outside the blessed module, defeating the single-source-of-truth
 * design. The dependency-cruiser config (./.dependency-cruiser.cjs) is
 * the second layer of defence at the import-graph level.
 */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '**/*.test.ts'],
  },

  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: 2022,
      },
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value='collected_revenue_v']",
          message:
            "The view name 'collected_revenue_v' may only appear in src/metrics/repository.ts (the blessed query module) and src/db/schema.ts (the Drizzle declaration). Re-route through metrics/repository instead.",
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Carve-outs for the modules that are AUTHORISED to mention the view name.
  {
    files: ['src/metrics/repository.ts', 'src/db/schema.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
);
