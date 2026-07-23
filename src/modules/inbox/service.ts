/**
 * Inbox message service — persist-then-publish for the Sales inbox, mirroring
 * modules/retention/notify.ts. Writing a row via the webhook or an internal caller flows through
 * here so the same act (persist to mytrion_inbox_messages, then push a live event to the owner's
 * `/v1/realtime` topic) happens in one place. The frontend consumes the list DTO from the REST
 * route and refreshes on the realtime event.
 */
import type { MytrionInboxMessage } from '../../db/schema/index.js';
import {
  mytrionInboxMessageRepo,
  type CreateInboxMessageInput,
} from '../../repos/mytrionInboxMessageRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { publishInboxEvent } from '../realtime/hub.js';

/** Map Zoho `Priority` (small/medium/high) to the realtime event priority (low/medium/high). */
function eventPriority(p: string): 'low' | 'medium' | 'high' {
  const x = p.toLowerCase();
  if (x === 'high' || x === 'critical') return 'high';
  if (x === 'small' || x === 'low') return 'low';
  return 'medium';
}

/** The item shape the Sales inbox list consumes (mirrors the legacy `inbox.list` message). */
export interface InboxMessageDto {
  id: string;
  name: string | null;
  subject: string;
  content: string | null;
  type: string;
  priority: string;
  tag: string | null;
  sourceUrl: string | null;
  createdTime: string;
  ownerId: string;
  ownerName: string | null;
  ownerEmail: string | null;
}

export function toInboxMessageDto(row: MytrionInboxMessage): InboxMessageDto {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    content: row.content,
    type: row.type,
    priority: row.priority,
    tag: row.tag,
    sourceUrl: row.sourceUrl,
    // Prefer the CRM creation time; fall back to our insert time.
    createdTime: (row.zohoCreatedAt ?? row.createdAt).toISOString(),
    ownerId: row.ownerZohoUserId,
    ownerName: row.ownerName,
    ownerEmail: row.ownerEmail,
  };
}

/**
 * Persist one inbox message, then push it live to the owner's realtime topic. Returns the row and
 * the live-delivery count (0 when the owner has no socket open — the row still surfaces on the next
 * fetch). Use from the webhook and from any internal "several places" that raise a notification.
 */
export async function createInboxMessage(
  ctx: TenantContext,
  input: CreateInboxMessageInput,
): Promise<{ message: MytrionInboxMessage; delivered: number }> {
  const message = await mytrionInboxMessageRepo.create(ctx, input);
  // Built as a standalone const (not a fresh literal at the call) so the extra fields ride through
  // publishInboxEvent's structural param without tripping excess-property checks.
  const event = {
    id: message.id,
    type: 'inbox.message.created',
    tag: message.tag,
    ownerKind: 'worker' as const,
    ownerId: message.ownerZohoUserId,
    title: message.subject,
    detail: message.content,
    priority: eventPriority(message.priority),
    readAt: null,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
  };
  const delivered = publishInboxEvent(event);
  return { message, delivered };
}
