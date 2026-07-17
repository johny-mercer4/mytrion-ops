import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { isAppError } from '../lib/errors.js';
import { resolveWidgetDir } from './widgetStatic.js';

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

const GENERIC_MESSAGE = 'Internal server error';

/** Backend paths that must NEVER fall back to the SPA — they return a real JSON 404 instead. */
const API_PREFIXES = ['/v1', '/health', '/docs', '/documentation', '/realtime', '/mini-app', '/widget'];

export function errorHandlerPlugin(app: FastifyInstance): void {
  // The worker portal is a single-page app served at the root. A hard refresh / deep link to a
  // client route (e.g. /m/sales) or the bare domain (/) is not a file, so it lands here — serve the
  // SPA shell so its router can take over. API paths and non-HTML requests still get a JSON 404.
  const widgetDir = resolveWidgetDir();
  const spaIndex = widgetDir && existsSync(path.join(widgetDir, 'index.html'))
    ? path.join(widgetDir, 'index.html')
    : null;

  app.setNotFoundHandler((request, reply) => {
    const urlPath = request.url.split('?')[0] ?? '/';
    const isApi = API_PREFIXES.some((p) => urlPath === p || urlPath.startsWith(`${p}/`));
    const wantsHtml = (request.headers.accept ?? '').includes('text/html');
    if (spaIndex && request.method === 'GET' && !isApi && wantsHtml) {
      void reply.header('Cache-Control', 'no-cache').type('text/html').send(createReadStream(spaIndex));
      return;
    }
    void reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${request.method} ${request.url} not found`,
        requestId: request.requestId,
      },
    } satisfies ErrorResponse);
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    let statusCode = 500;
    let code = 'INTERNAL_ERROR';
    let message = GENERIC_MESSAGE;
    let details: unknown;
    let expose = false;

    if (error instanceof ZodError) {
      statusCode = 400;
      code = 'VALIDATION_ERROR';
      message = 'Request validation failed';
      details = error.flatten();
      expose = true;
    } else if (isAppError(error)) {
      statusCode = error.statusCode;
      code = error.code;
      message = error.message;
      details = error.details;
      expose = error.expose;
    } else if (error.validation) {
      statusCode = 400;
      code = 'VALIDATION_ERROR';
      message = error.message;
      details = error.validation;
      expose = true;
    } else if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      statusCode = error.statusCode;
      code = error.code ?? 'REQUEST_ERROR';
      message = error.message;
      expose = true;
    }

    if (statusCode >= 500) {
      request.log.error({ err: error, requestId: request.requestId }, 'request failed');
    } else {
      request.log.warn({ code, msg: error.message, requestId: request.requestId }, 'request error');
    }

    const body: ErrorResponse = {
      error: {
        code,
        message: expose ? message : GENERIC_MESSAGE,
        requestId: request.requestId,
      },
    };
    if (expose && details !== undefined) body.error.details = details;

    void reply.status(statusCode).send(body);
  });
}
