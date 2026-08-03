/**
 * Ticketing Deluge touchpoints — the two writes the Sales Create tab needs to file a ticket or an
 * escalation in Zoho Desk. All writes.
 *
 * Restored (2026-08-03) with the Desk create path. The original file also carried
 * `tickets.upload_attachment` and `tickets.upload_escalation_attachment`; those are deliberately NOT
 * back, because the routes attach files directly through the Desk API (`uploadTicketAttachment`) with
 * a CRM-record fallback, and those two touchpoints had no callers even before the Desk removal.
 */
import { z } from 'zod';
import type { Touchpoint } from '../types.js';
import { idString, SALES, shortText } from './common.js';

export const ticketsDelugeTouchpoints: Touchpoint[] = [
  {
    kind: 'deluge',
    key: 'tickets.create_escalation',
    title: 'Create escalation ticket',
    riskClass: 'write',
    departments: SALES,
    identityParam: 'userId',
    functionNames: ['createescalationticket'],
    unwrap: 'permissive', // success = ticketId + escalationId in the payload
    paramsSchema: z.object({
      escalationReason: shortText(300),
      questionSubject: shortText(300),
      description: shortText(5000),
      userId: idString.optional(),
      attachmentUrl: z.string().max(2000).default(''),
    }),
  },
  {
    kind: 'deluge',
    key: 'tickets.create_in_crm',
    title: 'Link a Desk ticket into CRM',
    riskClass: 'write',
    departments: SALES,
    functionNames: ['createticketincrm'],
    unwrap: 'permissive',
    paramsSchema: z.object({
      subject: shortText(300),
      dealId: idString,
      deskTicketId: idString,
    }),
  },
];
