/**
 * Zoho Desk deep link (octanefuel org) — open a CS ticket directly in Desk's agent console
 * instead of an agent copying the ticket number and searching for it (QA 2026-08-07).
 *
 * Pattern and org confirmed against a real Desk URL for another department
 * (`/agent/octanefuel/billing-and-accounting/tickets/details/<id>`); the `customer-service` slug
 * is verified live against `GET /departments` — department 1057080000000323033 (DESK_DEPARTMENTS.cs
 * in zohoDesk.ts) is named "Customer Service", and Desk slugs are the department name lowercased
 * and hyphenated (billing's "Billing and Accounting" -> "billing-and-accounting" is the same rule).
 *
 * Takes Desk's own ticket id (CsOpenTicket.id), NOT the human-facing ticketNumber — the URL segment
 * is the internal id.
 */
const DESK_ORG = 'https://desk.zoho.com/agent/octanefuel';
const CS_DEPT_SLUG = 'customer-service';

export function deskTicketUrl(ticketId: string): string {
  return `${DESK_ORG}/${CS_DEPT_SLUG}/tickets/details/${encodeURIComponent(ticketId)}`;
}
