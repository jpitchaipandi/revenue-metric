import Fastify, { type FastifyInstance } from 'fastify';
import { logger } from '../config/logger.js';
import { healthRoutes } from './routes/health.js';
import { installErrorHandler } from './plugins/error-handler.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    disableRequestLogging: true,
    bodyLimit: 1_048_576,
  });

  app.addHook('onRequest', async (req) => {
    logger.debug({ method: req.method, url: req.url }, 'request');
  });

  installErrorHandler(app);

  await app.register(healthRoutes);

  return app;
}
