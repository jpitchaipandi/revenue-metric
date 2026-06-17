import { pino } from 'pino';
import { env } from './env.js';

const isDev = env.NODE_ENV === 'development';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: {
    service: 'revenue-metric',
    env: env.NODE_ENV,
  },
  redact: {
    paths: [
      '*.api_key',
      '*.secret',
      '*.password',
      'req.headers.authorization',
      'req.headers["stripe-signature"]',
    ],
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
        },
      }
    : {}),
});

export type Logger = typeof logger;
