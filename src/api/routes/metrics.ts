import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { computeTimeseries, computeTotal } from '../../metrics/service.js';
import { listUnknownStatuses } from '../../metrics/repository.js';

const TotalQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  currency: z.string().length(3).toUpperCase().default('USD'),
});

const TimeseriesQuerySchema = TotalQuerySchema.extend({
  granularity: z.enum(['day', 'week', 'month']).default('day'),
});

/**
 * Metric endpoints. INTENTIONALLY PUBLIC — no auth.
 *
 * Reviewers, monitoring tools, or any internal dashboard can call
 * these directly. If you later wire this into a customer-facing
 * dashboard, add a read-only API key — but the design doesn't
 * require it.
 */
export const metricsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/metrics/revenue/total', async (req, reply) => {
    const parsed = TotalQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: {
          code: 'INVALID_QUERY',
          message: parsed.error.issues[0]?.message ?? 'bad query',
        },
      });
    }
    const result = await computeTotal(parsed.data);
    return reply.send({ success: true, data: result });
  });

  app.get('/metrics/revenue/timeseries', async (req, reply) => {
    const parsed = TimeseriesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: {
          code: 'INVALID_QUERY',
          message: parsed.error.issues[0]?.message ?? 'bad query',
        },
      });
    }
    const result = await computeTimeseries(parsed.data);
    return reply.send({ success: true, data: result });
  });

  // Diagnostic: lists distinct (source, source_status) pairs that
  // currently map to UNKNOWN. Empty result = healthy.
  // Non-empty = action needed (add to src/status/mappers.ts, re-ingest).
  app.get('/metrics/status-coverage', async (_req, reply) => {
    const rows = await listUnknownStatuses();
    return reply.send({
      success: true,
      data: {
        unknown_statuses: rows.map((r) => ({
          source: r.source,
          source_status: r.sourceStatus,
          count: r.count,
          first_seen: r.firstSeen.toISOString(),
          last_seen: r.lastSeen.toISOString(),
        })),
      },
    });
  });
};
