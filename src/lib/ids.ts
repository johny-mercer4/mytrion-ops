import { createId, isCuid } from '@paralleldrive/cuid2';

/** Generate a collision-resistant id (cuid2). */
export function newId(): string {
  return createId();
}

/** Generate a prefixed id, e.g. `conv_xxxxx`, for readability in logs/URLs. */
export function newPrefixedId(prefix: string): string {
  return `${prefix}_${createId()}`;
}

/** Validate a raw or prefixed id. */
export function isValidId(id: string): boolean {
  const raw = id.includes('_') ? id.slice(id.lastIndexOf('_') + 1) : id;
  return isCuid(raw);
}
