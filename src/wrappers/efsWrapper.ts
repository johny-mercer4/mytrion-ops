/**
 * Named façade over the EFS-touching servercrm endpoints — EFS itself (the vendor SOAP
 * CardManagementWS) is never reached directly from here; servercrm holds the live SOAP client
 * (servercrm/services/efs.js). This wrapper only formalizes the HTTP surface. See
 * src/integrations/efs.ts for the dormant direct-SOAP client (unused by design; kept for a future
 * direct-EFS path if servercrm is ever bypassed).
 *
 * Paths mirror this repo's own touchpoint catalog (src/modules/touchpoints/catalog/serverCrmMisc.ts
 * — efs.cards/efs.card_info/efs.card_override — and serverCrmAgent.ts — dwh.card_efs/dwh.card_activate),
 * confirmed rather than guessed.
 */
import { crmGet, crmPost } from './serverCrmClient.js';

export interface UpdateCardInfoFields {
  unitNumber?: string | undefined;
  driverId?: string | undefined;
  driverName?: string | undefined;
}

export const efsWrapper = {
  /** Bulk EFS card list for a carrier, including live fraud-hold status — the lower-level,
   * live-EFS counterpart of serverCrmWrapper.getCards (which reads the DWH mart instead). */
  getCards(carrierId: string) {
    return crmPost('/api/efs/cards', { carrierId });
  },

  /** Update a card's unit number / driver info via EFS (a write, despite the "info" name) —
   * at least one of unitNumber/driverId/driverName is required upstream. */
  updateCardInfo(carrierId: string, cardNumber: string, fields: UpdateCardInfoFields) {
    return crmPost('/api/efs/card/info', { carrierId, cardNumber, ...fields });
  },

  /** Fraud-hold override — a ~30-minute card unlock. */
  overrideCard(carrierId: string, cardNumber: string) {
    return crmPost('/api/efs/card/override', { carrierId, cardNumber });
  },

  /** Live EFS info for one carrier's card (DWH-path variant, keyed by carrierId + cardNumber). */
  getCardEfsInfo(carrierId: string, cardNumber: string) {
    return crmGet(`/api/agent/dwh/cards/${encodeURIComponent(carrierId)}/${encodeURIComponent(cardNumber)}/efs`);
  },

  /** Activate a carrier's card via EFS. */
  activateCard(carrierId: string, cardNumber: string) {
    return crmPost(`/api/agent/dwh/cards/${encodeURIComponent(carrierId)}/${encodeURIComponent(cardNumber)}/activate`);
  },

  /** C-1 / C-3 — flip a card ACTIVE/INACTIVE (full echo-back upstream preserves prompts/limits).
   * servercrm no-ops with a friendly message when the card is already in the target state. */
  setCardStatus(carrierId: string, cardNumber: string, action: 'activate' | 'deactivate') {
    return crmPost('/api/efs/card/status', { carrierId, cardNumber, action: action.toUpperCase() });
  },

  /** C-4 / C-5 — INCREASE/DECREASE one EFS limit bucket by `value`. servercrm merges policy ∪ card
   * limits and writes the adjusted set back; `value` is the CHANGE amount, not the new absolute. */
  setCardLimits(
    carrierId: string,
    cardNumber: string,
    change: { limitId: string; value: number; action: 'increase' | 'decrease' },
  ) {
    return crmPost('/api/efs/card/limits', {
      carrierId,
      cardNumber,
      limitId: change.limitId,
      value: change.value,
      action: change.action.toUpperCase(),
    });
  },

  /** C-10 — raise a fraud hold/release request (servercrm forwards to the fraud team's intake;
   * no direct EFS mutation happens here). */
  fraudHoldRelease(payload: {
    carrierId: string;
    cardNumber: string;
    ticketType: 'fraud_hold' | 'fraud_release';
    companyName: string;
    agentEmail: string;
  }) {
    return crmPost('/api/fraud/hold-release', payload);
  },
};
