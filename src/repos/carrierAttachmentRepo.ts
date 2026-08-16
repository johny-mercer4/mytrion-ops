/**
 * carrier_attachments — files attached to an existing carrier. Metadata only; bytes live
 * behind `storageFor()` (`src/modules/files/storage`). Every method takes `ctx` first and
 * every `where` leads with `tenant_id`, so a carrier id guessed from another tenant returns
 * nothing — including on delete.
 */
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  carrierAttachments,
  type CarrierAttachment,
  type NewCarrierAttachment,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, firstOrUndefined } from './util.js';

export const carrierAttachmentRepo = {
  async insert(
    ctx: TenantContext,
    row: Omit<NewCarrierAttachment, 'tenantId'>,
  ): Promise<CarrierAttachment> {
    const rows = await db
      .insert(carrierAttachments)
      .values({ ...row, tenantId: ctx.tenantId })
      .returning();
    return firstOrThrow(rows, 'Failed to record carrier attachment');
  },

  async listByCarrier(ctx: TenantContext, carrierId: string): Promise<CarrierAttachment[]> {
    return db
      .select()
      .from(carrierAttachments)
      .where(
        and(eq(carrierAttachments.tenantId, ctx.tenantId), eq(carrierAttachments.carrierId, carrierId)),
      )
      .orderBy(asc(carrierAttachments.createdAt));
  },

  async find(
    ctx: TenantContext,
    carrierId: string,
    attachmentId: string,
  ): Promise<CarrierAttachment | undefined> {
    return firstOrUndefined(
      await db
        .select()
        .from(carrierAttachments)
        .where(
          and(
            eq(carrierAttachments.tenantId, ctx.tenantId),
            eq(carrierAttachments.carrierId, carrierId),
            eq(carrierAttachments.id, attachmentId),
          ),
        )
        .limit(1),
    );
  },

  async delete(
    ctx: TenantContext,
    carrierId: string,
    attachmentId: string,
  ): Promise<CarrierAttachment | undefined> {
    return firstOrUndefined(
      await db
        .delete(carrierAttachments)
        .where(
          and(
            eq(carrierAttachments.tenantId, ctx.tenantId),
            eq(carrierAttachments.carrierId, carrierId),
            eq(carrierAttachments.id, attachmentId),
          ),
        )
        .returning(),
    );
  },
};
