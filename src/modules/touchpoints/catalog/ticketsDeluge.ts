/**
 * Ticketing Deluge touchpoints — escalation + CRM support tickets and their attachment
 * hand-offs. All writes.
 */
import { z } from 'zod';
import type { Touchpoint } from '../types.js';
import { idString, shortText } from './common.js';

export const ticketsDelugeTouchpoints: Touchpoint[] = [
  {
    kind: 'deluge',
    key: 'tickets.create_escalation',
    title: 'Create escalation ticket',
    riskClass: 'write',
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
    functionNames: ['createticketincrm'],
    unwrap: 'permissive',
    paramsSchema: z.object({
      subject: shortText(300),
      dealId: idString,
      deskTicketId: idString,
    }),
  },
  {
    kind: 'deluge',
    key: 'tickets.upload_attachment',
    title: 'Attach a file to a Desk ticket',
    riskClass: 'write',
    functionNames: ['uploadticketattachment'],
    unwrap: 'permissive',
    paramsSchema: z.object({
      ticketId: idString,
      dealId: idString,
      attachmentId: idString,
      fileName: shortText(300),
      orgId: idString,
    }),
  },
  {
    kind: 'deluge',
    key: 'tickets.upload_escalation_attachment',
    title: 'Attach a file to an escalation request',
    riskClass: 'write',
    functionNames: ['uploadescalationattachment'],
    unwrap: 'permissive',
    paramsSchema: z.object({
      ticketId: idString,
      recordId: idString,
      attachmentId: idString,
      fileName: shortText(300),
      orgId: idString,
    }),
  },
];
