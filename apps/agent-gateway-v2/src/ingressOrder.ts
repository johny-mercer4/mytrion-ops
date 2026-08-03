/**
 * Run one Telegram batch concurrently across users while preserving source order inside each
 * `(chat, user)` lane. The session queue can only preserve enqueue order; this guard ensures
 * asynchronous carrier/role lookups cannot enqueue a later message first.
 */
export async function processInOrderByKey<T>(
  items: readonly T[],
  keyFor: (item: T) => string,
  process: (item: T) => Promise<void>,
): Promise<void> {
  const lanes = new Map<string, Promise<void>>();
  for (const item of items) {
    const key = keyFor(item);
    const next = (lanes.get(key) ?? Promise.resolve()).then(() => process(item));
    lanes.set(key, next);
  }
  await Promise.all(lanes.values());
}
