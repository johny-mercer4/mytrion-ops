/**
 * Carrier Telegram mini-app sign-ins, as audit rows.
 *
 * This is the "when did a carrier log in" event, and before this module it did not exist. The one
 * route that wrote `mini_app.auth.login` was the PASSWORD login — and the live table has zero rows
 * for it, because the carriers on this bot are legacy `telegram` auth-mode registrations that never
 * present a password. The real sign-in is the mini app calling `/carrier/mini-app/auth/state` and
 * being told `authenticated`, so that is what gets logged here.
 *
 * NOTE: this is the carrier client bot (TELEGRAM_CARRIER_BOT_TOKEN), not the Horizon worker bot.
 *
 * The mini app re-bootstraps on every open — and Telegram re-opens a WebView freely — so the row is
 * collapsed to one per carrier per session window rather than one per bootstrap.
 */
import { DEFAULT_TENANT_ID } from '../../config/constants.js';
import { auditFromContext } from '../audit/auditLogger.js';
import { auditSessionEvent } from '../audit/sessionEvents.js';
import type { TenantContext } from '../../types/tenantContext.js';
import type { MiniAppActorRegistration } from './miniAppAuth.js';

/** How the carrier proved who they are on this sign-in. */
export type MiniAppLoginMethod = 'telegram' | 'password';

/**
 * Identity context for the login row. Deliberately NOT `telegramCtx()`: that one carries no
 * company and no display name, so every carrier login would land as an anonymous
 * `telegram:<id>` with an empty Company column — the exact opposite of what this is for.
 */
function loginCtx(registration: MiniAppActorRegistration, telegramUserId: string): TenantContext {
  const company = registration.companyName ?? registration.carrierId ?? null;
  const displayName =
    registration.driverName ?? registration.companyName ?? registration.telegramUsername ?? null;
  const ctx: TenantContext = {
    tenantId: registration.tenantId || DEFAULT_TENANT_ID,
    userId: `telegram:${telegramUserId}`,
    audience: 'customer',
    role: registration.profile === 'driver' ? 'driver' : 'fleet_manager',
    scopes: [],
    // auditFromContext derives the Company column from departments for customer-audience rows.
    departments: company ? [company] : [],
    allDepartmentAccess: false,
    profiles: [registration.profile],
    requestId: `mini-app-login-${telegramUserId}`,
  };
  if (displayName) ctx.userName = displayName;
  return ctx;
}

/**
 * Record a carrier mini-app sign-in. Best-effort by construction (auditSessionEvent swallows write
 * failures downstream) — a logging blip must never block a carrier from opening the app.
 * Returns true when a row was actually written (false = collapsed into the open session).
 */
export async function auditMiniAppLogin(
  registration: MiniAppActorRegistration,
  telegramUserId: string,
  method: MiniAppLoginMethod,
  opts: { collapse?: boolean } = {},
): Promise<boolean> {
  const ctx = loginCtx(registration, telegramUserId);
  const fields = {
    action: 'mini_app.auth.login',
    status: 'ok' as const,
    resourceType: 'registered_mini_app_company',
    resourceId: registration.id,
    detail: {
      method,
      profile: registration.profile,
      ...(registration.companyName ? { companyName: registration.companyName } : {}),
      ...(registration.carrierId ? { carrierId: registration.carrierId } : {}),
      ...(registration.telegramUsername ? { telegramUsername: registration.telegramUsername } : {}),
      ...(registration.agentName ? { agentName: registration.agentName } : {}),
      telegramUserId,
    },
  };
  // An explicit password sign-in is a deliberate act, so it is always its own row. Bootstrap
  // re-opens are not — Telegram re-opens the WebView freely — so those collapse into the window.
  if (opts.collapse === false) {
    await auditFromContext(ctx, fields);
    return true;
  }
  return auditSessionEvent(ctx, fields);
}
