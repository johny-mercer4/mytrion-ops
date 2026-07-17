import type { ServiceKey } from './demo';
import type { ServiceRequestKey } from './api';

/** What the action bottom sheet is currently showing — one of the canonical self-service views, or a
 *  generic (catalog-item-titled) service request. A generic carrying `request` files a real Desk
 *  ticket; one without it still shows the placeholder confirmation and sends nothing. */
export type OpenAction =
  | { kind: 'service'; key: ServiceKey }
  | { kind: 'generic'; key: string; title: string; request?: ServiceRequestKey };
