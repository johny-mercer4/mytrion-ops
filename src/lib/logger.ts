import { pino, type Logger } from 'pino';
import { env, isDev, isTest } from '../config/env.js';
import { APP_NAME } from '../config/constants.js';

const prettyTransport = isDev
  ? {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
    }
  : undefined;

export const logger: Logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  base: { service: APP_NAME },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      'req.headers["x-ingest-secret"]',
      'password',
      '*.password',
      'token',
      '*.token',
      'accessToken',
      '*.accessToken',
      'access_token',
      '*.access_token',
      'refreshToken',
      '*.refreshToken',
      'refresh_token',
      '*.refresh_token',
      'secret',
      '*.secret',
      'client_secret',
      '*.client_secret',
      'connectionString',
      '*.connectionString',
    ],
    censor: '[redacted]',
  },
  ...(prettyTransport ? { transport: prettyTransport } : {}),
});

export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}

export type { Logger };
