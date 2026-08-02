import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, type DbOrTx } from '../db/client.js';
import {
  mytrionThreadAttachments,
  type MytrionThreadAttachment,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow } from './util.js';

/**
 * Chat attachments — the join between a thread message and the stored bytes.
 *
 * AUTHORIZATION IS THE CALLER'S JOB, exactly as in `commsMessageRepo`: every read here is reached only after
 * `commsThreadRepo.getForReader` has proved the caller may read the thread. There is no reader filter of its
 * own, because a second implementation of the gate is a second thing to keep in sync.
 *
 * `storage` records WHICH provider holds the bytes, mirroring `file_assets.storage_provider`. It is
 * denormalised onto this row so a list can render "on Dropbox" without joining file_assets, and so an
 * orphaned attachment row still says where to look.
 */

export interface AddAttachmentInput {
  threadId: string;
  /** The message this file belongs to. One bubble carries its text and its files together. */
  messageId?: string | null;
  fileAssetId: string;
  storage: 's3' | 'dropbox';
  name: string;
  mime?: string | null;
  sizeBytes?: number | null;
  /** A durable link, when the provider gives one. Left NULL for a proxied download. */
  externalUrl?: string | null;
  /**
   * Inherited from the parent message, never passed independently: a file on an internal note must not
   * become visible just because the attachment row said otherwise.
   */
  isInternal?: boolean;
  uploadedByZohoUserId?: string | null;
  uploadedByCarrierId?: string | null;
}

export const commsAttachmentRepo = {
  async add(
    ctx: TenantContext,
    input: AddAttachmentInput,
    tx: DbOrTx = db,
  ): Promise<MytrionThreadAttachment> {
    const rows = await tx
      .insert(mytrionThreadAttachments)
      .values({
        tenantId: ctx.tenantId,
        threadId: input.threadId,
        messageId: input.messageId ?? null,
        fileAssetId: input.fileAssetId,
        storage: input.storage,
        name: input.name,
        mime: input.mime ?? null,
        sizeBytes: input.sizeBytes ?? null,
        externalUrl: input.externalUrl ?? null,
        isInternal: input.isInternal ?? false,
        uploadedByZohoUserId: input.uploadedByZohoUserId ?? null,
        uploadedByCarrierId: input.uploadedByCarrierId ?? null,
      })
      .returning();
    return firstOrThrow(rows, 'thread attachment insert returned no row');
  },

  /** Split out for offline `.toSQL()` assertions in the RBAC-leakage suite. */
  buildListQuery(ctx: TenantContext, threadId: string, opts: { excludeInternal?: boolean } = {}) {
    const where = [
      eq(mytrionThreadAttachments.tenantId, ctx.tenantId),
      eq(mytrionThreadAttachments.threadId, threadId),
    ];
    // Applied in SQL, not in a serializer: a file on an internal note must not reach the response object at
    // all for a reader who may not see it.
    if (opts.excludeInternal) where.push(eq(mytrionThreadAttachments.isInternal, false));
    return db
      .select()
      .from(mytrionThreadAttachments)
      .where(and(...where))
      .orderBy(asc(mytrionThreadAttachments.createdAt));
  },

  async listByThread(
    ctx: TenantContext,
    threadId: string,
    opts: { excludeInternal?: boolean } = {},
  ): Promise<MytrionThreadAttachment[]> {
    return this.buildListQuery(ctx, threadId, opts);
  },

  /** Attachments for a page of messages, without N queries. */
  async listByMessageIds(
    ctx: TenantContext,
    messageIds: string[],
  ): Promise<MytrionThreadAttachment[]> {
    if (messageIds.length === 0) return [];
    return db
      .select()
      .from(mytrionThreadAttachments)
      .where(
        and(
          eq(mytrionThreadAttachments.tenantId, ctx.tenantId),
          inArray(mytrionThreadAttachments.messageId, messageIds),
        ),
      );
  },

  /**
   * One attachment, scoped to its thread.
   *
   * The thread id is REQUIRED rather than optional: it forces the caller to have resolved a readable thread
   * first, so an attachment id alone can never be turned into a download.
   */
  async getInThread(
    ctx: TenantContext,
    threadId: string,
    attachmentId: string,
  ): Promise<MytrionThreadAttachment | undefined> {
    const [row] = await db
      .select()
      .from(mytrionThreadAttachments)
      .where(
        and(
          eq(mytrionThreadAttachments.tenantId, ctx.tenantId),
          eq(mytrionThreadAttachments.threadId, threadId),
          eq(mytrionThreadAttachments.id, attachmentId),
        ),
      )
      .limit(1);
    return row;
  },
};
