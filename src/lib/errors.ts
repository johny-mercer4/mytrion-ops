/**
 * Application error hierarchy. Every thrown error that reaches the HTTP layer is
 * normalized by plugins/errorHandler.ts using statusCode/code/expose.
 */

export interface AppErrorOptions {
  statusCode?: number;
  code?: string;
  details?: unknown;
  cause?: unknown;
  /** Whether `message` is safe to return to the client. Defaults to statusCode < 500. */
  expose?: boolean;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: unknown;
  readonly expose: boolean;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = this.constructor.name;
    this.statusCode = options.statusCode ?? 500;
    this.code = options.code ?? 'INTERNAL_ERROR';
    this.details = options.details;
    this.expose = options.expose ?? this.statusCode < 500;
    // Maintains a clean stack trace where available (V8).
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/** 401 — missing/invalid credentials. */
export class AuthError extends AppError {
  constructor(message = 'Unauthorized', options: AppErrorOptions = {}) {
    super(message, { statusCode: 401, code: 'AUTH_ERROR', expose: true, ...options });
  }
}

/** 403 — authenticated but not permitted (role/scope/audience/tenant mismatch). */
export class RBACError extends AppError {
  constructor(message = 'Forbidden', options: AppErrorOptions = {}) {
    super(message, { statusCode: 403, code: 'RBAC_DENIED', expose: true, ...options });
  }
}

/** 404 — resource not found (or hidden by tenant isolation). */
export class NotFoundError extends AppError {
  constructor(message = 'Not found', options: AppErrorOptions = {}) {
    super(message, { statusCode: 404, code: 'NOT_FOUND', expose: true, ...options });
  }
}

/** 409 — conflicting state (e.g. duplicate email). */
export class ConflictError extends AppError {
  constructor(message = 'Conflict', options: AppErrorOptions = {}) {
    super(message, { statusCode: 409, code: 'CONFLICT', expose: true, ...options });
  }
}

/** 400 — input failed validation. */
export class ValidationError extends AppError {
  constructor(message = 'Validation failed', options: AppErrorOptions = {}) {
    super(message, { statusCode: 400, code: 'VALIDATION_ERROR', expose: true, ...options });
  }
}

/** 429 — rate limit exceeded. */
export class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded', options: AppErrorOptions = {}) {
    super(message, { statusCode: 429, code: 'RATE_LIMITED', expose: true, ...options });
  }
}

/** 422 — a tool handler failed (vendor error, bad args after schema, etc.). */
export class ToolError extends AppError {
  constructor(message = 'Tool execution failed', options: AppErrorOptions = {}) {
    super(message, { statusCode: 422, code: 'TOOL_ERROR', expose: true, ...options });
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/** Best-effort extraction of a human-readable message from any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}
