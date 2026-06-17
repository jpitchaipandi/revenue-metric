import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { UnknownSourceError } from '../../errors/domain-errors.js';
import { ingestMock } from '../../sources/mock/ingest.js';
import { ingestStripe } from '../../sources/stripe/ingest.js';
import { authPlugin } from '../plugins/auth.js';
import type { IngestResult } from '../../sources/types.js';

const KNOWN_SOURCES = ['mock', 'stripe'] as const;
type KnownSource = (typeof KNOWN_SOURCES)[number];

const SourceParamSchema = z.object({
  source: z.enum(['mock', 'stripe']),
});

async function runIngestFor(source: KnownSource): Promise<IngestResult> {
  switch (source) {
    case 'mock':
      return ingestMock();
    case 'stripe':
      return ingestStripe();
    default: {
      const _exhaustive: never = source;
      throw new UnknownSourceError(_exhaustive);
    }
  }
}

/**
 * Ingest endpoints. BEARER-PROTECTED via authPlugin registered inside
 * this scope (encapsulation isolates the hook from /metrics/* which
 * remains public).
 *
 * Phase 2 wires only the mock source; Phase 3 adds Stripe.
 */
export const ingestRoutes: FastifyPluginAsync = async (app) => {
  await app.register(authPlugin);

  app.post('/ingest/:source', async (req, reply) => {
    const params = SourceParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({
        success: false,
        error: { code: 'UNKNOWN_SOURCE', message: 'Unknown source' },
      });
    }
    const result = await runIngestFor(params.data.source);
    return reply.code(200).send({ success: true, data: result });
  });

  app.post('/ingest/all', async (_req, reply) => {
    const results: IngestResult[] = [];
    for (const source of KNOWN_SOURCES) {
      try {
        results.push(await runIngestFor(source));
      } catch (err) {
        // Mirror sync-pipeline's failure-isolation pattern: one source's
        // failure does not block the others.
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          source,
          recordsFetched: 0,
          recordsUpserted: 0,
          recordsSkipped: 0,
          unknownStatusesFound: 0,
          durationMs: 0,
          // Failure surfaced via a special field — the type still validates
          // and the caller sees which source(s) failed at a glance.
          ...{ error: { message } },
        } as IngestResult);
      }
    }
    return reply.code(200).send({ success: true, data: { results } });
  });
};
