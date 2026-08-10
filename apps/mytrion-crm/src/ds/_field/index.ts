
/**
 * `{ ...defaults, ...overrides }` where `overrides` has optional keys widens EVERY key to
 * `T | undefined`, even though the defaults supply all of them — so every downstream call site then
 * reads as possibly-undefined. This merges by dropping keys the caller did not set, which is what
 * the spread was meant to express, and returns the resolved shape.
 *
 * Used by every component that takes a `labels` / `messages` prop, so the fix lives once.
 */
export type Resolved<T> = { [K in keyof T]-?: NonNullable<T[K]> };

export function withDefaults<T extends object>(defaults: Resolved<T>, overrides?: T | undefined): Resolved<T> {
  if (!overrides) return defaults;
  const out = { ...defaults };
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
