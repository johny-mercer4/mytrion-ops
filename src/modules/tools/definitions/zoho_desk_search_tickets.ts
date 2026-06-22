import { z } from 'zod';
import { listTickets } from '../../../integrations/zohoDesk.js';
import type { ToolManifest } from '../types.js';

const inputSchema = z.object({
  /** Filter by ticket status, e.g. 'Open', 'On Hold', 'Closed'. */
  status: z.string().min(1).max(50).optional(),
  /** Restrict to one Desk department id (see the knowledge base for the name → id mapping). */
  departmentId: z.string().min(1).max(50).optional(),
  /** Sort order; default newest first. */
  sortBy: z
    .enum(['createdTime', '-createdTime', 'dueDate', '-dueDate', 'recentThread', '-recentThread'])
    .optional(),
  /** Max tickets to return (default 20, max 99 — Desk's record-list cap). */
  limit: z.number().int().min(1).max(99).optional(),
});

const outputSchema = z.object({
  count: z.number(),
  tickets: z.array(
    z.object({
      id: z.string(),
      ticketNumber: z.string().optional(),
      subject: z.string().optional(),
      status: z.string().optional(),
      priority: z.string().optional(),
      departmentId: z.string().optional(),
      assigneeId: z.string().optional(),
      createdTime: z.string().optional(),
      dueDate: z.string().optional(),
    }),
  ),
});

/**
 * Real tool (Zoho Desk). List recent tickets, optionally filtered by status and/or department.
 * Returns a trimmed summary per ticket. Internal use only.
 */
export const zohoDeskSearchTicketsTool: ToolManifest<
  z.infer<typeof inputSchema>,
  z.infer<typeof outputSchema>
> = {
  name: 'zoho_desk.search_tickets',
  description:
    'List recent Zoho Desk support tickets (newest first). Optional filters: `status` (e.g. Open, ' +
    'On Hold, Closed), `departmentId`, and `sortBy`. Returns id, ticketNumber, subject, status, ' +
    'priority, department, assignee, and timestamps. Internal use only.',
  inputSchema,
  outputSchema,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: ['zoho_desk:read'],
  rateLimit: { perMinute: 30 },
  async handler(input) {
    const tickets = await listTickets(input);
    return { count: tickets.length, tickets };
  },
};
