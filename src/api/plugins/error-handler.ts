import type { FastifyInstance, FastifyError } from 'fastify';
import { logger } from '../../config/logger.js';
import { RevenueError } from '../../errors/domain-errors.js';

/**
 * Installs a global error handler that maps every thrown error into our
 * envelope:  { success: false, error: { code, message } }.
 *
 * Domain errors (`RevenueError` and subclasses) carry their own `code`
 * and use 4xx HTTP statuses by default; everything else is logged and
 * returned as a generic 500 INTERNAL_ERROR (no stack-trace leakage).
 */
export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof RevenueError) {
      logger.warn(
        { err, url: req.url, code: err.code, context: err.context },
        'domain_error',
      );
      const statusCode = mapDomainCodeToStatus(err.code);
      return reply.code(statusCode).send({
        success: false,
        error: { code: err.code, message: err.message },
      });
    }

    if (err.validation) {
      logger.warn({ err, url: req.url }, 'validation_error');
      return reply.code(400).send({
        success: false,
        error: { code: 'INVALID_QUERY', message: err.message },
      });
    }

    logger.error({ err, url: req.url }, 'unhandled_error');
    return reply.code(err.statusCode ?? 500).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  });
}

function mapDomainCodeToStatus(code: string): number {
  switch (code) {
    case 'UNAUTHORIZED':
      return 401;
    case 'UNKNOWN_SOURCE':
    case 'INVALID_QUERY':
    case 'INVALID_CURRENCY':
      return 400;
    case 'INGEST_ERROR':
    case 'UNMAPPED_STATUS':
      return 422;
    default:
      return 500;
  }
}
