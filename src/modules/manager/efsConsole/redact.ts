/**
 * Money-code redaction. The single most important file in this module.
 *
 * An unredeemed money code is a BEARER INSTRUMENT: whoever has the digits can draw the cash at a
 * truck stop. The established rule across Octane — set by modules/finance/financeEfs.ts and by the
 * carrier self-service surface, which strips `efs_money_code` and exposes a `has_code` flag — is
 * that the value reaches the carrier through the CMP notification and NOBODY reads it out of a UI.
 *
 * EFS's `getMoneyCodes` returns the full `code` on every row. This module keeps the last four
 * digits for reconciliation against a paper trail and drops the rest before the payload leaves the
 * server, so the digits never enter a browser, a browser cache, a screenshot or a support ticket.
 *
 * Do not "temporarily" pass the full code through for debugging. Log the codeId — it is the safe
 * handle and it is what `moneyCodes.detail` takes.
 */

/** Field names EFS uses for the redeemable digits, across V1 and V2 payload shapes. */
const CODE_FIELDS = ['code', 'alphaCode', 'moneyCode', 'efsMoneyCode', 'codeValue'] as const;

/** `1234567` → `••••4567`. Short or missing values collapse to a constant, never a partial leak. */
function lastFour(value: unknown): string {
  const digits = String(value ?? '').trim();
  if (digits.length < 4) return '••••';
  return `••••${digits.slice(-4)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Replace every code-bearing field on one row with a masked last-four, under a NEW key
 * (`codeLast4`) so a consumer that reaches for `row.code` gets `undefined` rather than something
 * that looks usable. Everything else on the row passes through untouched.
 */
function redactRow(row: unknown): unknown {
  if (!isRecord(row)) return row;
  const out: Record<string, unknown> = { ...row };
  let masked: string | null = null;
  for (const field of CODE_FIELDS) {
    if (field in out) {
      if (masked === null) masked = lastFour(out[field]);
      delete out[field];
    }
  }
  if (masked !== null) out['codeLast4'] = masked;
  return out;
}

/**
 * Walk a payload of unknown shape and redact every row that carries a code, wherever it sits.
 *
 * Deliberately structural rather than keyed to one response shape: servercrm returns money codes
 * under `data` in one call, `raw` in another, and V2 changes the row shape again. A redactor that
 * only understood today's envelope would silently stop redacting the day the envelope moved, and
 * the failure mode is leaking bearer instruments. Depth is bounded so a cyclic or pathological
 * payload cannot hang the request.
 */
function walk(value: unknown, depth: number): unknown {
  if (depth > 8) return value;
  if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1));
  if (!isRecord(value)) return value;

  const carriesCode = CODE_FIELDS.some((field) => field in value);
  const base = carriesCode ? (redactRow(value) as Record<string, unknown>) : { ...value };
  for (const [key, child] of Object.entries(base)) {
    if (Array.isArray(child) || isRecord(child)) base[key] = walk(child, depth + 1);
  }
  return base;
}

/** Redact a money-code LIST response (`moneyCodes.list`). */
export function redactMoneyCodes(payload: unknown): unknown {
  return walk(payload, 0);
}

/**
 * Redact a single money-code DETAIL response (`moneyCodes.detail`).
 *
 * Same treatment as the list. It is a separate export only so the intent is legible at the call
 * site in fetchers.ts and so the two can diverge if EFS's detail shape ever needs special care.
 */
export function redactMoneyCodeDetail(payload: unknown): unknown {
  return walk(payload, 0);
}
