import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { closePool } from './db/client.js';
import { buildApp } from './api/server.js';

async function start(): Promise<void> {
  const app = await buildApp();

  try {
    const address = await app.listen({ port: env.PORT, host: '0.0.0.0' });
    logger.info({ address, env: env.NODE_ENV }, 'revenue_metric_started');
  } catch (err) {
    logger.fatal({ err }, 'failed_to_start_server');
    process.exit(1);
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting_down');
    await app.close();
    await closePool();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void start();
