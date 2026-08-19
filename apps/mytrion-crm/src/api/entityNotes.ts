import { request } from './transport';
import type { EntityNoteRow } from './touchpointTypes';

export type { EntityNoteRow };

export async function listEntityNotes(
  entityType: string,
  entityId: string,
): Promise<EntityNoteRow[]> {
  const data = await request('GET', '/entity-notes', {
    query: { entity_type: entityType, entity_id: entityId },
  });
  return (data as { notes: EntityNoteRow[] }).notes;
}

export async function createEntityNote(input: {
  entityType: string;
  entityId: string;
  content: string;
  authorName?: string;
}): Promise<EntityNoteRow> {
  const data = await request('POST', '/entity-notes', {
    body: {
      entity_type: input.entityType,
      entity_id: input.entityId,
      content: input.content,
      ...(input.authorName ? { author_name: input.authorName } : {}),
    },
  });
  return (data as { note: EntityNoteRow }).note;
}

export async function deleteEntityNote(id: string): Promise<void> {
  await request('DELETE', `/entity-notes/${encodeURIComponent(id)}`, {});
}
