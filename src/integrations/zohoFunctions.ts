/**
 * Zoho custom-function (Deluge) executor — the reusable "zohoFunctionCalled" wrapper.
 *
 * Call shape (ported from the servercrm reference implementation and the legacy widget):
 *   POST {functionsBase}/{name}/actions/execute      — NO request body
 *     ?auth_type=oauth
 *     &arguments=<JSON.stringify(args)>              — args ride a single QUERY param
 *   Authorization: Zoho-oauthtoken <access token>
 *
 * The function's return value arrives as `details.output` — usually a STRINGIFIED JSON
 * map, occasionally plain text, and sometimes with bare numeric keys ({90002:"…"}) that
 * need quoting before JSON.parse. Success signalling varies per function, so callers pick
 * an unwrap mode matching the widget's convention for that function.
 *
 * Tokens come from the managed cache (wrapper.getZohoToken('crm')) by default; a caller
 * may pass `opts.accessToken` to use its own token (one-off scripts). On a 401 with the
 * managed token, the cache entry is invalidated and the call retried exactly once.
 */
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { fetchWithTimeout } from '../lib/http.js';
import { getZohoToken, invalidateZohoToken } from './zohoAuth.js';

/** 502-mapped error — the errorHandler plugin normalizes AppError for the HTTP layer. */
export class ZohoFunctionError extends AppError {
  constructor(
    message: string,
    options: { functionName: string; httpStatus?: number | undefined; cause?: unknown } = {
      functionName: 'unknown',
    },
  ) {
    super(message, {
      statusCode: 502,
      code: 'ZOHO_FUNCTION_ERROR',
      expose: true,
      details: { functionName: options.functionName, httpStatus: options.httpStatus },
      cause: options.cause,
    });
  }
}

/**
 * Deluge argument map — serialized whole into the `arguments` query param. Values may be
 * nested (e.g. mytrioncreatelead's createPayload object); undefined entries are dropped.
 */
export type DelugeArgs = Record<string, unknown>;

/**
 * How to detect success in the function output (widget conventions):
 *  - 'status'      — requires `status === 'success'`, else throws with the payload message.
 *  - 'successFlag' — requires `success === true` (loose: also accepts 'true'/'success').
 *  - 'permissive'  — returns `data ?? Result ?? Response ?? parsed` without judging.
 *  - 'cardAction'  — the widget's EFS card idiom: unwrap `data/Result/Response`, then treat
 *                    an EXPLICIT failure flag (success:false | status:'error' | error/
 *                    errorMessage present) as a failure; otherwise return the unwrapped body.
 */
export type UnwrapMode = 'status' | 'successFlag' | 'permissive' | 'cardAction';

export interface ExecuteZohoFunctionOptions {
  /** Use this token instead of the managed cache (disables the 401 retry). */
  accessToken?: string | undefined;
  unwrap?: UnwrapMode | undefined;
}

/** The org the executor targets — PRODUCTION unless ZOHO_FUNCTIONS_ENV=sandbox. */
export function activeZohoFunctionsEnv(): 'production' | 'sandbox' {
  return env.ZOHO_FUNCTIONS_ENV;
}

/** The token service matching the active env (sandbox orgs need their own refresh token). */
function tokenService(): 'crm' | 'crm_sandbox' {
  return activeZohoFunctionsEnv() === 'sandbox' ? 'crm_sandbox' : 'crm';
}

/**
 * Functions API root for the ACTIVE env:
 *  - production: ZOHO_FUNCTIONS_BASE_URL override, else ORIGIN of ZOHO_CRM_API_DOMAIN
 *    + /crm/v2/functions.
 *  - sandbox:    ZOHO_FUNCTIONS_SANDBOX_BASE_URL (+ the sandbox refresh token).
 */
export function zohoFunctionsBaseUrl(): string {
  if (activeZohoFunctionsEnv() === 'sandbox') {
    return env.ZOHO_FUNCTIONS_SANDBOX_BASE_URL.trim().replace(/\/+$/, '');
  }
  const configured = env.ZOHO_FUNCTIONS_BASE_URL.trim().replace(/\/+$/, '');
  if (configured) return configured;
  return `${new URL(env.ZOHO_CRM_API_DOMAIN).origin}/crm/v2/functions`;
}

/**
 * Parse a Deluge `details.output` value: quote bare numeric keys, then JSON.parse.
 * Non-JSON text is returned as-is (some functions emit plain strings).
 */
export function parseFunctionOutput(raw: string): unknown {
  const text = raw.trim();
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    // Deluge maps can serialize with unquoted numeric keys: {90002:"Multiple carriers"}.
    const repaired = text.replace(/([{,]\s*)(\d+)(\s*:)/g, '$1"$2"$3');
    try {
      return JSON.parse(repaired);
    } catch {
      // Some functions (mytrionfetchannouncements) emit a bracket-LESS comma-joined record
      // list: `{...},{...}`. The widget wraps it in [] before parsing — only when the wrap
      // yields a valid array (plain error text still falls through to the raw string).
      if (/^\{.*\}$/s.test(text) && text.includes('},{')) {
        try {
          return JSON.parse(`[${text}]`);
        } catch {
          /* fall through */
        }
      }
      return text;
    }
  }
}

function messageOf(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    const m = p.message ?? p.error ?? p.errorMessage;
    if (typeof m === 'string' && m) return m;
  }
  return typeof payload === 'string' ? payload : 'Zoho function reported a failure';
}

function applyUnwrap(functionName: string, payload: unknown, mode: UnwrapMode): unknown {
  if (mode === 'permissive' || mode === 'cardAction') {
    const unwrapped =
      payload && typeof payload === 'object'
        ? ((payload as Record<string, unknown>).data ??
          (payload as Record<string, unknown>).Result ??
          (payload as Record<string, unknown>).Response ??
          payload)
        : payload;
    // cardAction: after unwrapping, reject only on an EXPLICIT failure signal (matches the
    // widget). A body with none of these keys is treated as success (EFS echo-backs).
    if (mode === 'cardAction' && unwrapped && typeof unwrapped === 'object') {
      const u = unwrapped as Record<string, unknown>;
      const explicitFailure =
        u.success === false ||
        u.success === 'false' ||
        u.status === 'error' ||
        u.status === 'failure' ||
        (u.error != null && u.error !== '') ||
        (u.errorMessage != null && u.errorMessage !== '');
      if (explicitFailure) throw new ZohoFunctionError(messageOf(unwrapped), { functionName });
    }
    return unwrapped;
  }
  const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const ok =
    mode === 'status'
      ? p.status === 'success'
      : p.success === true || p.success === 'true' || p.status === 'success';
  if (!ok) throw new ZohoFunctionError(messageOf(payload), { functionName });
  return payload;
}

/** True when Zoho's response says the function itself doesn't exist (fallback-pair trigger). */
function isFunctionNotFound(httpStatus: number, bodyText: string): boolean {
  if (httpStatus === 404) return true;
  if (httpStatus !== 400) return false;
  return /FUNCTION_NOT_FOUND|INVALID_FUNCTION|RESOURCE_NOT_FOUND/i.test(bodyText);
}

interface RawExecution {
  httpStatus: number;
  bodyText: string;
}

async function executeOnce(
  functionName: string,
  args: DelugeArgs,
  accessToken: string,
): Promise<RawExecution> {
  const url = new URL(`${zohoFunctionsBaseUrl()}/${encodeURIComponent(functionName)}/actions/execute`);
  url.searchParams.set('auth_type', 'oauth');
  const defined: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined) defined[key] = value;
  }
  url.searchParams.set('arguments', JSON.stringify(defined));
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  return { httpStatus: res.status, bodyText: await res.text() };
}

/**
 * Execute one Deluge function and return its (unwrapped) output.
 * The generic is a caller-side assertion — Deluge outputs are not schema-validated here.
 */
export async function executeZohoFunction<T = unknown>(
  functionName: string,
  args: DelugeArgs,
  opts: ExecuteZohoFunctionOptions = {},
): Promise<T> {
  const managed = opts.accessToken === undefined;
  const service = tokenService();
  let token = opts.accessToken ?? (await getZohoToken(service)).accessToken;
  let exec: RawExecution;
  try {
    exec = await executeOnce(functionName, args, token);
    if (exec.httpStatus === 401 && managed) {
      invalidateZohoToken(service);
      token = (await getZohoToken(service)).accessToken;
      exec = await executeOnce(functionName, args, token);
    }
  } catch (err) {
    throw new ZohoFunctionError(`Zoho function '${functionName}' request failed`, {
      functionName,
      cause: err,
    });
  }

  if (exec.httpStatus < 200 || exec.httpStatus >= 300) {
    throw new ZohoFunctionError(
      `Zoho function '${functionName}' → HTTP ${exec.httpStatus}: ${exec.bodyText.slice(0, 300)}`,
      { functionName, httpStatus: exec.httpStatus },
    );
  }

  let output: unknown = null;
  if (exec.bodyText) {
    let body: unknown;
    try {
      body = JSON.parse(exec.bodyText);
    } catch {
      throw new ZohoFunctionError(`Zoho function '${functionName}' returned a non-JSON envelope`, {
        functionName,
        httpStatus: exec.httpStatus,
      });
    }
    const envelope = body as { code?: unknown; details?: { output?: unknown } };
    const rawOutput = envelope.details?.output;
    // Zoho answers a crashed function with HTTP 200 + a non-'success' code and no output.
    // Don't let that surface as a silent null "success" on permissive touchpoints.
    if (
      (rawOutput === undefined || rawOutput === null) &&
      typeof envelope.code === 'string' &&
      envelope.code.toLowerCase() !== 'success'
    ) {
      throw new ZohoFunctionError(`Zoho function '${functionName}' failed (code: ${envelope.code})`, {
        functionName,
        httpStatus: exec.httpStatus,
      });
    }
    output = typeof rawOutput === 'string' ? parseFunctionOutput(rawOutput) : (rawOutput ?? null);
  }
  return applyUnwrap(functionName, output, opts.unwrap ?? 'permissive') as T;
}

/**
 * Try each function name in order — the legacy Deluge functions exist under inconsistent
 * casings (mytrionCheckPayment vs mytrioncheckpayment). Falls through ONLY when Zoho says
 * the function doesn't exist; any other failure is rethrown immediately.
 */
export async function executeZohoFunctionWithFallback<T = unknown>(
  functionNames: readonly [string, ...string[]],
  args: DelugeArgs,
  opts: ExecuteZohoFunctionOptions = {},
): Promise<T> {
  let lastError: unknown;
  for (const name of functionNames) {
    try {
      return await executeZohoFunction<T>(name, args, opts);
    } catch (err) {
      lastError = err;
      if (err instanceof ZohoFunctionError) {
        const { httpStatus } = err.details as { httpStatus?: number };
        if (httpStatus !== undefined && isFunctionNotFound(httpStatus, err.message)) {
          continue;
        }
      }
      throw err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new ZohoFunctionError('No Zoho function name resolved', {
        functionName: functionNames[0],
      });
}
