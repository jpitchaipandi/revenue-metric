import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv({ path: ['.env.local', '.env'] });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL: z.string().url(),
  DATABASE_URL_DIRECT: z.string().url().optional(),

  API_SECRET: z.string().min(32).optional(),

  STRIPE_TEST_KEY: z
    .string()
    .startsWith('sk_test_', 'STRIPE_TEST_KEY must be a Stripe test-mode secret key')
    .optional(),

  INGEST_START_DATE: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'INGEST_START_DATE must be YYYY-MM-DD')
    .default('2024-01-01'),

  MOCK_CSV_PATH: z.string().default('src/sources/mock/data.csv'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
