import type { ServiceKey } from './demo';

/** What the action bottom sheet is currently showing — one of the 7 canonical self-service views, or a generic (catalog-item-titled) service request. */
export type OpenAction = { kind: 'service'; key: ServiceKey } | { kind: 'generic'; key: string; title: string };
