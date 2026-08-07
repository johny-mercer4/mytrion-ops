import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { isAppError } from '../lib/errors.js';
import { isTransientDbError } from '../modules/jobs/bossErrors.js';
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

/**
 * Vitest and some bundled entrypoints can load more than one physical Zod copy. In that case an
 * otherwise genuine ZodError fails `instanceof ZodError`, which used to turn malformed requests
 * into an HTTP 500. Keep the nominal check, then use Zod's stable error shape as a cross-realm
 * fallback.
 */
function isZodValidationError(error: unknown): error is ZodError {
  if (error instanceof ZodError) return true;
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; issues?: unknown; flatten?: unknown };
  return (
    candidate.name === 'ZodError' &&
    Array.isArray(candidate.issues) &&
    typeof candidate.flatten === 'function'
  );
}

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

    // The portal SPA is built with relative asset paths (vite base './'), which the Zoho widget
    // bundle sharing the build requires. At a nested route like /main/<slug>, the browser resolves
    // `./assets/x.css` against /main/ — /main/assets/x.css — which is not where the assets live
    // (/assets/x.css), so it lands here. A CSS/JS request's Accept isn't text/html, so it fell
    // through to the JSON 404 below, and X-Content-Type-Options: nosniff then blocked the
    // stylesheet/module — a blank page at /main/adminmytrion. Redirect any depth's /assets/ request
    // to the root-absolute path the static host actually serves.
    const assetIdx = urlPath.indexOf('/assets/');
    if (request.method === 'GET' && !isApi && assetIdx > 0) {
      void reply.redirect(urlPath.slice(assetIdx), 308);
      return;
    }
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

    if (isZodValidationError(error)) {
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
    } else if (isTransientDbError(error)) {
      /**
       * The link to Postgres was down, not the request wrong.
       *
       * Handled centrally rather than per route: this deployment's database sleeps when idle, so the
       * first read after a quiet spell fails — and which route happens to be first is arbitrary. One
       * route had its own try/catch for this and every other one returned a bare 500 with a Drizzle
       * stack, which reads as "the feature is broken" rather than "try again in a moment".
       */
      statusCode = 503;
      code = 'DB_UNAVAILABLE';
      message = 'The database is temporarily unavailable — please retry in a moment.';
      expose = true;
      void reply.header('Retry-After', '5');
    } else if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      statusCode = error.statusCode;
      code = error.code ?? 'REQUEST_ERROR';
      message = error.message;
      details = (error as FastifyError & { details?: unknown }).details;
      expose = true;
    }

    if (code === 'DB_UNAVAILABLE') {
      // A sleeping database waking up is expected operational noise, not a fault to page on. One line,
      // no stack — the stack is always the same and says nothing about the request.
      request.log.warn(
        { code, msg: error.message, requestId: request.requestId },
        'database unavailable — transient',
      );
    } else if (statusCode >= 500) {
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
