import type { FastifyInstance } from 'fastify';
import { ping } from '../../db/client.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_req, reply) => {
    const dbOk = await ping();
    return reply.code(dbOk ? 200 : 503).send({
      success: dbOk,
      data: {
        status: dbOk ? 'ok' : 'error',
        db: dbOk ? 'ok' : 'error',
        uptime: process.uptime(),
      },
    });
  });
}
