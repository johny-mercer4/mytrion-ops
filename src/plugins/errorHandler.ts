import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { isAppError } from '../lib/errors.js';

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

const GENERIC_MESSAGE = 'Internal server error';

export function errorHandlerPlugin(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
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
