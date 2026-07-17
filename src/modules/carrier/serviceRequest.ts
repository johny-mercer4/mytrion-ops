/**
 * Mini-app service requests → real Zoho Desk tickets.
 *
 * Until now every "request" item in the catalog was `action: 'generic'`, which called
 * sendGenericRequest() in the mini-app: it prepended a local inbox row saying "Request sent" and
 * made NO network call at all. Nothing was ever sent — the driver believed a human had been asked.
 *
 * These requests are not direct writes to the card. A driver tapping "Override the card" does not
 * open the card; it files a ticket to Customer Service, and a human performs the override. That is
 * why this path does not need CLAUDE.md rule 7's admin role: the authority stays with CS, and the
 * ticket is the audit trail.
 *
 * servercrm has its own /api/mobile/create-ticket doing roughly this, but it is not the right
 * upstream here: it needs MOBILE_AUTH_KEY/MOBILE_SECRET_TOKEN (not configured in this service), and
 * it resolves the Desk contact by phone/email — returning 400 "contact was not found" when neither
 * matches. A Telegram registration has no phone or email, so that path cannot file a driver's
 * ticket at all. createDeskTicket() posts an INLINE contact that Desk finds-or-creates, so a
 * name-only requester works, and the identifying detail rides in the custom fields (the same
 * cf_carrier_id_application_id / cf_card_number the CRM ticket wizard stamps — how CS actually
 * identifies an account).
 */
import { createDeskTicket, DESK_DEPARTMENTS, type DeskDeptSlug } from '../../integrations/zohoDesk.js';

export type ServiceRequestKey =
  | 'override-card'
  | 'money-code'
  | 'card-activate'
  | 'card-limit'
  | 'card-replace'
  | 'card-fraud'
  | 'billing-form'
  | 'ref-guides';

interface ServiceRequestSpec {
  /** Desk ticket subject. Prefixed with the channel so CS can see where it came from. */
  subject: string;
  dept: DeskDeptSlug;
  /** Who may file this. Deliberately explicit per key — adding a role here grants it, so the
   *  decision is visible in review rather than implied by a catalog entry in the front end. */
  roles: readonly ('owner' | 'driver')[];
  /** Desk cf_ticket_type — mirrors the CRM wizard's vocabulary. */
  ticketType: string;
}

/**
 * The requests a mini-app user may file, and who may file them.
 *
 * Departments mirror servercrm's own routing for the same prompts (routes/mobileAppRoutes.js:
 * "override card" / "card management" / "request increasing daily limit" / "efs code request" →
 * Customer Service; "billing" → Billing and Accounting), so a mini-app ticket lands in the queue
 * that already handles that request from the mobile app.
 *
 * A driver may file only what concerns the card in their hand. The owner-side entries are card and
 * account administration — the driver catalog does not offer them, and this map is what enforces
 * that rather than the absence of a button.
 *
 * Note what a key here does NOT grant: 'money-code' for a driver is not "a driver may issue money
 * codes". It files a request; a human at CS decides and issues. Same for the card writes — the
 * authority never moves to the mini-app, which is why none of this needs CLAUDE.md rule 7's admin
 * role.
 */
const SERVICE_REQUESTS: Record<ServiceRequestKey, ServiceRequestSpec> = {
  'override-card': {
    subject: 'Override the card (30-min fraud open)',
    dept: 'cs',
    roles: ['owner', 'driver'],
    ticketType: 'Card Management',
  },
  'money-code': {
    subject: 'Request an EFS Money Code',
    dept: 'cs',
    roles: ['owner', 'driver'],
    ticketType: 'EFS Code Request',
  },
  'card-activate': {
    subject: 'Activate / deactivate a card',
    dept: 'cs',
    roles: ['owner'],
    ticketType: 'Card Management',
  },
  'card-limit': {
    subject: "Adjust a card's limit (gal/day)",
    dept: 'cs',
    roles: ['owner'],
    ticketType: 'Card Management',
  },
  'card-replace': {
    subject: 'Replace a lost or stolen card',
    dept: 'cs',
    roles: ['owner'],
    ticketType: 'Card Management',
  },
  'card-fraud': {
    subject: 'Report fraud / suspicious charge',
    dept: 'cs',
    roles: ['owner'],
    ticketType: 'Card Management',
  },
  'billing-form': {
    subject: 'Billing Form',
    dept: 'billing',
    roles: ['owner'],
    ticketType: 'Billing',
  },
  'ref-guides': {
    subject: 'Reference guides',
    dept: 'cs',
    roles: ['owner'],
    ticketType: 'Reports Center',
  },
};

/** Every key, for the route's Zod enum — so adding one above cannot be forgotten at the schema. */
export const SERVICE_REQUEST_KEYS = Object.keys(SERVICE_REQUESTS) as [ServiceRequestKey, ...ServiceRequestKey[]];

export function serviceRequestSpec(key: ServiceRequestKey): ServiceRequestSpec {
  return SERVICE_REQUESTS[key];
}

export function serviceRequestAllows(key: ServiceRequestKey, profile: 'owner' | 'driver'): boolean {
  return SERVICE_REQUESTS[key].roles.includes(profile);
}

export interface FileServiceRequestInput {
  key: ServiceRequestKey;
  profile: 'owner' | 'driver';
  carrierId: string;
  /** The requester's card. For a driver this is resolved SERVER-SIDE from their registration and is
   *  never caller-supplied — otherwise a driver could file an override against a colleague's card. */
  cardNumber: string | null;
  requesterName: string;
  telegramUserId: string;
  telegramUsername: string | null;
  companyName: string | null;
  /** Free text the user typed. Untrusted — it is ticket body content, never an instruction. */
  comment: string | null;
}

/** Build the ticket body. Everything CS needs to act without opening another system. */
function describe(input: FileServiceRequestInput): string {
  const lines = [
    `Request: ${SERVICE_REQUESTS[input.key].subject}`,
    `Submitted from: Octane Telegram mini-app (${input.profile})`,
    `Carrier ID: ${input.carrierId}`,
    ...(input.companyName ? [`Company: ${input.companyName}`] : []),
    ...(input.cardNumber ? [`Card: ${input.cardNumber}`] : []),
    `Requested by: ${input.requesterName}`,
    // The reachable identity: a Telegram registration carries no phone or email, so this is how CS
    // gets back to the person. The bot can message this user; a Desk contact record cannot.
    `Telegram: ${input.telegramUsername ? `@${input.telegramUsername}` : `user ${input.telegramUserId}`}`,
  ];
  if (input.comment) lines.push('', 'Comment from the requester:', input.comment);
  return lines.join('\n');
}

/** File the request as a Desk ticket. Returns the new ticket id. */
export async function fileServiceRequest(input: FileServiceRequestInput): Promise<string> {
  const spec = SERVICE_REQUESTS[input.key];
  return createDeskTicket({
    subject: `Mini-app: ${spec.subject}`,
    description: describe(input),
    departmentId: DESK_DEPARTMENTS[spec.dept],
    channel: 'Ticket Form',
    contact: { lastName: input.requesterName || 'Driver' },
    cf: {
      cf_ticket_type: spec.ticketType,
      cf_carrier_id_application_id: input.carrierId,
      ...(input.cardNumber ? { cf_card_number: input.cardNumber } : {}),
      cf_submitted_by: input.requesterName,
    },
  });
}
