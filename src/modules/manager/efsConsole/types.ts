/**
 * EFS Console — shared descriptor types.
 *
 * The console fronts ~37 read endpoints and ~30 write endpoints on servercrm's
 * `/api/efs/console`. Writing 67 hand-rolled Fastify handlers would be 67 places to get the auth
 * gate, the window rule, the redaction and the audit key subtly different. Instead the whole
 * surface is DATA — one descriptor per endpoint — and there are exactly two handlers: one that
 * dispatches a fetcher and one that dispatches an action.
 *
 * That also satisfies the standing requirement that the full vendor surface be present in code
 * even where no UI exists for it yet: an endpoint with no `ui` home is still declared, still
 * validated, still gated, and a test asserts none has been forgotten.
 */
import type { z } from 'zod';

/** Which half of the vendor surface a descriptor belongs to. */
export type EfsSide = 'parent' | 'carrier';

/**
 * How wide a date window the endpoint tolerates.
 *
 * These are the VENDOR's ceilings, not ours, and exceeding them is a 400 from EFS rather than a
 * silent clamp — so they are validated here, before the call, and published to the UI so the date
 * picker can refuse the range instead of the user discovering it as a failure.
 */
export type EfsWindowRule = 'none' | 'txn7d' | 'history90d';

export const EFS_WINDOW_MAX_DAYS: Record<EfsWindowRule, number | null> = {
  none: null,
  txn7d: 7,
  history90d: 90,
};

/**
 * Whether an endpoint is known to work.
 *
 * `broken` is not pessimism — `/fetchers/carrier/:id/rejects` returns HTTP 500
 * `ADBException: Unexpected subelement startDate` for every date format tried, confirmed against
 * prod on 2026-08-04 (see modules/finance/financeEfs.ts) and again on 2026-08-06. It stays in the
 * catalog because it is part of the vendor surface and will presumably be fixed upstream, but it
 * is never offered in the UI and the route refuses it with a specific message rather than letting
 * an operator watch a spinner end in a 502.
 */
export type EfsHealth = 'ok' | 'broken';

export interface EfsFetcher {
  /** Stable key the CRM calls us with, e.g. `carrier.cards`. Never the vendor path. */
  key: string;
  side: EfsSide;
  /** Vendor path under /api/efs/console/fetchers, with `:param` placeholders. */
  path: string;
  /** HTTP verb ON SERVERCRM. Two reads are modelled as POST because they take a body. */
  method: 'GET' | 'POST';
  label: string;
  window: EfsWindowRule;
  health: EfsHealth;
  /** Why a `broken` endpoint is broken — surfaced to the caller verbatim. */
  brokenReason?: string;
  /** Path params this fetcher needs beyond `carrierId`, in order of appearance. */
  pathParams?: readonly string[];
  /** Query params passed through to the vendor, allow-listed so a typo cannot silently vanish. */
  query?: readonly string[];
  /** Body schema for the POST-modelled reads. */
  bodySchema?: z.ZodTypeAny;
  /**
   * Redact the response before it leaves the server. Money-code payloads go through
   * `redactMoneyCodes` — an unredeemed code is a bearer instrument and its digits must never reach
   * a browser. See redact.ts.
   */
  redact?: (payload: unknown) => unknown;
  /** Rough cost, measured against prod. Drives the UI's "this will take a moment" affordance. */
  latency: 'fast' | 'slow' | 'very-slow';
}

/**
 * What a write can do if it is ever armed. Drives the extra role check in the dispatcher, per
 * CLAUDE.md rule 7 (write tools require admin) — the department gate alone is not enough for
 * anything that moves money or destroys a record.
 */
export type EfsRiskClass = 'write' | 'money' | 'destructive';

export interface EfsAction {
  /** Stable key, e.g. `funding.topup`. This is what the audit row records. */
  key: string;
  /** Vendor path under /api/efs/console/actions. */
  path: string;
  label: string;
  group:
    | 'funding'
    | 'money-codes'
    | 'cards'
    | 'policy'
    | 'locations'
    | 'orders'
    | 'parent-child'
    | 'discounts'
    | 'smartpay'
    | 'mileage';
  riskClass: EfsRiskClass;
  /** One line an operator reads before confirming. Written for a human, not a changelog. */
  effect: string;
  schema: z.ZodTypeAny;
  /**
   * Preconditions that must hold before the call is made, as declarations rather than code so the
   * preview can state them and the arming phase can enforce them without re-deriving the rules.
   * e.g. a void requires the code to be entirely unused; a card action requires the card to be
   * ACTIVE in the LIVE card list, never in the ~3h-stale DWH mart.
   */
  checks?: readonly string[];
  /**
   * Whether a UI surface exists for this action today. Actions with no home are still declared,
   * routed and gated — they simply have no button. Kept honest by a test.
   */
  ui: 'cards' | 'money-codes' | null;
}
