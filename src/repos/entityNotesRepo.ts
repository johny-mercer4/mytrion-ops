/**
 * entityNotesRepo — tenant-scoped CRUD for entity_notes.
 * No FK to parent tables; entity_id is TEXT (bigserial PKs cast on write).
 */
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { entityNotes, type EntityNote, type NewEntityNote } from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';

export interface EntityNoteDto {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  content: string;
  authorZohoUserId: string | null;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toEntityNoteDto(row: EntityNote): EntityNoteDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    entityType: row.entityType,
    entityId: row.entityId,
    content: row.content,
    authorZohoUserId: row.authorZohoUserId,
    authorName: row.authorName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const entityNotesRepo = {
  async list(
    ctx: TenantContext,
    entityType: string,
    entityId: string,
  ): Promise<EntityNoteDto[]> {
    const rows = await db
      .select()
      .from(entityNotes)
      .where(
        and(
          eq(entityNotes.tenantId, ctx.tenantId),
          eq(entityNotes.entityType, entityType),
          eq(entityNotes.entityId, entityId),
        ),
      )
      .orderBy(asc(entityNotes.createdAt));
    return rows.map(toEntityNoteDto);
  },

  async insert(
    ctx: TenantContext,
    input: {
      entityType: string;
      entityId: string;
      content: string;
      authorZohoUserId?: string | null;
      authorName?: string | null;
    },
  ): Promise<EntityNoteDto> {
    const values: NewEntityNote = {
      tenantId: ctx.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      content: input.content.trim(),
      authorZohoUserId: input.authorZohoUserId?.trim() || null,
      authorName: input.authorName?.trim() || null,
    };
    const rows = await db.insert(entityNotes).values(values).returning();
    const row = rows[0];
    if (!row) throw new Error('Failed to insert entity note');
    return toEntityNoteDto(row);
  },

  async delete(ctx: TenantContext, id: string): Promise<boolean> {
    const rows = await db
      .delete(entityNotes)
      .where(and(eq(entityNotes.id, id), eq(entityNotes.tenantId, ctx.tenantId)))
      .returning({ id: entityNotes.id });
    return rows.length > 0;
  },
};
