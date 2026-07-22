/**
 * Shared low-level servercrm HTTP call + error mapping, used by every servercrm-backed wrapper
 * (serverCrmWrapper.ts, cmpWrapper.ts, efsWrapper.ts) so the error handling lives in exactly one
 * place instead of being copy-pasted per wrapper.
 */
import { serverCrmGet, serverCrmPost, ServerCrmHttpError } from '../integrations/serverCrm.js';
import { AppError } from '../lib/errors.js';

/** servercrm error bodies are JSON ({success:false, message:'...'}) — surface the message, not the raw blob. */
function extractUpstreamMessage(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as { message?: string; error?: string };
    return parsed.message ?? parsed.error ?? bodyText;
  } catch {
    return bodyText;
  }
}

function mapServerCrmError(err: unknown): never {
  if (err instanceof ServerCrmHttpError && [400, 404, 409, 422].includes(err.status)) {
    throw new AppError(
      err.bodyText ? extractUpstreamMessage(err.bodyText) : `servercrm rejected the request (${err.status})`,
      {
        statusCode: err.status,
        code: 'SERVER_CRM_REJECTED',
        expose: true,
        cause: err,
      },
    );
  }
  throw new AppError('servercrm request failed', {
    statusCode: 502,
    code: 'SERVER_CRM_ERROR',
    expose: true,
    cause: err,
  });
}

export async function crmGet<T = unknown>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
  try {
    return await serverCrmGet<T>(path, query);
  } catch (err) {
    mapServerCrmError(err);
  }
}

export async function crmPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  try {
    return await serverCrmPost<T>(path, body);
  } catch (err) {
    mapServerCrmError(err);
  }
}
