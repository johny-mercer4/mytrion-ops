/**
 * Carrier registration-invite creation — the ONE place all three creators go through (admin panel,
 * the owner's mini-app, and the Zoho sales self-service widget), so the business rules hold no
 * matter who calls:
 *   - an invite must be tied to a carrier_id or an application_id;
 *   - a DRIVER invite needs a driver name and an ACTIVE fuel card (validated against the DWH), and
 *     each active card takes at most one live driver (one-card-one-driver);
 *   - an OWNER invite's company type (owner-operator vs fleet-manager) is auto-detected from the
 *     carrier's active card count.
 * The caller layer only handles auth/scope; the rules live here.
 */
import { env } from '../../config/env.js';
import { AppError, ConflictError } from '../../lib/errors.js';
import { listDwhCards } from '../../integrations/dwhCards.js';
import { carrierInvitationRepo, type CarrierInvitationDto } from '../../repos/carrierInvitationRepo.js';
import { registeredMiniAppCompanyRepo } from '../../repos/registeredMiniAppCompanyRepo.js';
import type { CarrierCompanyType } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';

export interface CreateCarrierInviteArgs {
  profile: 'owner' | 'driver';
  carrierId?: string | undefined;
  applicationId?: string | undefined;
  companyName?: string | undefined;
  /** Driver only. */
  cardId?: string | undefined;
  /** Driver only. */
  driverName?: string | undefined;
  agentName?: string | undefined;
  agentZohoUserId?: string | undefined;
  /** Invite lifetime in hours (owner-issued driver links are 24h; default is the repo's 7 days). */
  ttlHours?: number | undefined;
}

/** Build the Telegram deep link. ?startapp= (direct open) once BotFather is configured, else ?start=. */
export function buildInviteUrl(inviteId: string): string {
  const bot = env.TELEGRAM_CARRIER_BOT_USERNAME;
  if (env.TELEGRAM_CARRIER_MINI_APP_SHORT_NAME) {
    return `https://t.me/${bot}/${env.TELEGRAM_CARRIER_MINI_APP_SHORT_NAME}?startapp=${inviteId}`;
  }
  if (env.TELEGRAM_CARRIER_MINI_APP_DIRECT === '1') {
    return `https://t.me/${bot}?startapp=${inviteId}`;
  }
  return `https://t.me/${bot}?start=${inviteId}`;
}

/**
 * Assert a card is an active fuel card of the carrier AND not already taken by a live driver
 * (pending invite or completed registration). Best-effort on activeness: if the DWH is
 * unconfigured we skip the active check (can't verify) but STILL enforce one-driver-per-card.
 */
async function assertDriverCardAvailable(
  ctx: TenantContext,
  carrierId: string,
  cardId: string,
): Promise<void> {
  if (env.DWH_DATABASE_URL) {
    const cards = await listDwhCards(carrierId);
    if (!cards.some((c) => c.cardId === cardId)) {
      throw new AppError('That card is not an active card of this carrier', {
        statusCode: 400,
        code: 'CARD_NOT_ACTIVE',
        expose: true,
      });
    }
  }
  const pending = await carrierInvitationRepo.findLiveDriverByCard(ctx, carrierId, cardId);
  if (pending) {
    throw new ConflictError('This card already has a pending driver invite');
  }
  const registered = await registeredMiniAppCompanyRepo.listDriversByCarrier(ctx, carrierId);
  if (registered.some((d) => d.cardId === cardId)) {
    throw new ConflictError('This card already has a registered driver');
  }
}

export async function createCarrierInvite(
  ctx: TenantContext,
  args: CreateCarrierInviteArgs,
): Promise<{ invite: CarrierInvitationDto; inviteUrl: string }> {
  if (!env.TELEGRAM_CARRIER_BOT_USERNAME) {
    throw new AppError('The carrier bot is not configured (TELEGRAM_CARRIER_BOT_USERNAME)', {
      statusCode: 503,
      code: 'BOT_UNCONFIGURED',
      expose: true,
    });
  }
  const carrierId = args.carrierId?.trim() || undefined;
  const applicationId = args.applicationId?.trim() || undefined;
  if (!carrierId && !applicationId) {
    throw new AppError('An invite needs a carrier_id or an application_id', {
      statusCode: 400,
      code: 'INVITE_UNTIED',
      expose: true,
    });
  }

  let companyType: CarrierCompanyType | undefined;
  let cardCount: number | undefined;
  const cardId = args.cardId?.trim() || undefined;
  const driverName = args.driverName?.trim() || undefined;

  if (args.profile === 'driver') {
    if (!carrierId) {
      throw new AppError('A driver invite needs the carrier_id (to validate the card)', {
        statusCode: 400,
        code: 'DRIVER_NEEDS_CARRIER',
        expose: true,
      });
    }
    if (!cardId) {
      throw new AppError('A driver invite needs the card it belongs to', {
        statusCode: 400,
        code: 'DRIVER_NEEDS_CARD',
        expose: true,
      });
    }
    if (!driverName) {
      throw new AppError('A driver invite needs the driver name', {
        statusCode: 400,
        code: 'DRIVER_NEEDS_NAME',
        expose: true,
      });
    }
    await assertDriverCardAvailable(ctx, carrierId, cardId);
  } else if (carrierId && env.DWH_DATABASE_URL) {
    // Owner: auto-detect company type from active card count (see carrier_invitations schema).
    try {
      const cards = await listDwhCards(carrierId);
      cardCount = cards.length;
      companyType = cardCount <= 1 ? 'owner-operator' : 'fleet-manager';
    } catch {
      // undetermined — an application-only invite or a DWH hiccup shouldn't block sending the link
    }
  }

  const invite = await carrierInvitationRepo.create(ctx, {
    profile: args.profile,
    ...(carrierId ? { carrierId } : {}),
    ...(applicationId ? { applicationId } : {}),
    ...(args.companyName?.trim() ? { companyName: args.companyName.trim() } : {}),
    ...(cardId ? { cardId } : {}),
    ...(driverName ? { driverName } : {}),
    ...(companyType ? { companyType } : {}),
    ...(cardCount !== undefined ? { cardCount } : {}),
    ...(args.agentName?.trim() ? { agentName: args.agentName.trim() } : {}),
    ...(args.agentZohoUserId?.trim() ? { agentZohoUserId: args.agentZohoUserId.trim() } : {}),
    ...(args.ttlHours !== undefined ? { ttlHours: args.ttlHours } : {}),
  });
  return { invite, inviteUrl: buildInviteUrl(invite.id) };
}
