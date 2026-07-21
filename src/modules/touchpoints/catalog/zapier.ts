/**
 * Zapier touchpoints — card replacement / account reactivation email requests.
 * Widget posts to hooks.zapier.com/…/433y0ax/; Ops proxies via ZAPIER_TICKET_WEBHOOK_URL.
 */
import { z } from 'zod';
import type { Touchpoint } from '../types.js';
import { carrierId, shortText } from './common.js';

export const zapierTouchpoints: Touchpoint[] = [
  {
    kind: 'zapier',
    key: 'zapier.ticket_email',
    title: 'Ticket email request (Zapier webhook)',
    riskClass: 'write',
    carrierParam: 'carrierId',
    method: 'POST',
    paramsSchema: z.object({
      companyName: shortText(300),
      carrierId,
      agentEmail: z.string().email().max(200),
      ticketType: z.enum(['replacement', 'reactivation']),
      companyAddress: z.string().max(500).optional().default(''),
      address: z.string().max(300).optional(),
      city: z.string().max(100).optional(),
      state: z.string().max(30).optional(),
      zip: z.string().max(20).optional(),
    }),
  },
];
