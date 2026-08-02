import { config } from './config.js';

/** Headers accepted only by the backend's support-bot service guard. */
export function supportBotHeaders(
  json = false,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return {
    'x-support-bot-key': config.octaneSupportBotKey,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...extra,
  };
}

export function backendErrorInfo(
  payload: Record<string, unknown>,
  status: number,
): { code: string; message: string } {
  const nested = payload['error'];
  const error = nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : payload;
  return {
    code: typeof error['code'] === 'string' ? error['code'] : `HTTP_${status}`,
    message: typeof error['message'] === 'string' ? error['message'] : `HTTP ${status}`,
  };
}
