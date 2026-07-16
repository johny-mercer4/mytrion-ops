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
};
