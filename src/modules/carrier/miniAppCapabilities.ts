import { RBACError } from '../../lib/errors.js';

/**
 * Coarse-grained capabilities for the Telegram mini-app.
 *
 * Capabilities answer "may this actor enter this class of operation?" They do not replace row
 * scope. Drivers remain pinned to their registered card, owners/managers remain pinned to their
 * registered carrier, and the future sales-agent principal must pass the live DWH ownership check
 * for the selected carrier on every request.
 */
export const MINI_APP_CAPABILITIES = [
  'company:read',
  'financial:read',
  'financial:write',
  'fleet:read',
  'fleet:manage',
  'card:write',
  'reports:send',
  'manager:invite',
  'access:manage',
  'service:request',
] as const;

export type MiniAppCapability = (typeof MINI_APP_CAPABILITIES)[number];
export type MiniAppActorProfile = 'owner' | 'manager' | 'driver' | 'sales_agent';

const OWNER_CAPABILITIES = MINI_APP_CAPABILITIES;

/**
 * Single role → capability policy.
 *
 * Managers preserve today's owner-equivalent behavior. Sales agents receive the same coarse
 * capabilities, including registration-link management, but their row authority comes from the
 * live CRM/DWH portfolio and ends when a company is reassigned.
 */
export const MINI_APP_CAPABILITIES_BY_PROFILE = {
  owner: OWNER_CAPABILITIES,
  manager: OWNER_CAPABILITIES,
  driver: ['company:read', 'card:write', 'reports:send', 'service:request'],
  // Sales agents can inspect an active assigned company and issue a manager onboarding link. They
  // still cannot mutate the account, manage existing access, send documents, or file requests.
  sales_agent: ['company:read', 'financial:read', 'fleet:read', 'manager:invite'],
} as const satisfies Record<MiniAppActorProfile, readonly MiniAppCapability[]>;

export function miniAppCapabilitiesFor(profile: MiniAppActorProfile): readonly MiniAppCapability[] {
  return MINI_APP_CAPABILITIES_BY_PROFILE[profile];
}

export function miniAppHasCapability(
  profile: MiniAppActorProfile,
  capability: MiniAppCapability,
): boolean {
  return (miniAppCapabilitiesFor(profile) as readonly MiniAppCapability[]).includes(capability);
}

export function assertMiniAppCapability(
  profile: MiniAppActorProfile,
  capability: MiniAppCapability,
): void {
  if (miniAppHasCapability(profile, capability)) return;
  throw new RBACError('This mini-app account cannot perform that action', {
    code: 'MINI_APP_CAPABILITY_DENIED',
    details: { capability },
  });
}
