/**
 * Wrapper registry — the list /v1/health/integrations reports on. Vendors register their
 * singleton (or a LAZY handle whose module is only imported on demand — required for
 * Composio, whose SDK must never load at boot while FF_COMPOSIO_ENABLED is off).
 * Registration is a Map.set: no env reads, no sockets.
 */
import { BaseWrapper, type WrapperHealth, type WrapperKind } from './base.js';

export interface LazyWrapper {
  name: string;
  kind: WrapperKind;
  /** Must not import the vendor module — env checks only. */
  isConfigured(): boolean;
  /** Import + return the real wrapper (only called when configured). */
  load(): Promise<BaseWrapper>;
}

const wrappers = new Map<string, BaseWrapper | LazyWrapper>();

export function registerWrapper(w: BaseWrapper | LazyWrapper): void {
  wrappers.set(w.name, w);
}

/** Test hook. */
export function clearWrapperRegistry(): void {
  wrappers.clear();
}

export async function wrapperHealthAll(opts: { live?: boolean } = {}): Promise<WrapperHealth[]> {
  const out: WrapperHealth[] = [];
  for (const w of wrappers.values()) {
    if (w instanceof BaseWrapper) {
      out.push(await w.health(opts));
      continue;
    }
    let configured = false;
    try {
      configured = w.isConfigured();
    } catch {
      configured = false;
    }
    if (!configured) {
      out.push({ name: w.name, kind: w.kind, configured: false, ok: false, detail: 'unconfigured' });
      continue;
    }
    try {
      const real = await w.load();
      out.push(await real.health(opts));
    } catch (err) {
      out.push({
        name: w.name,
        kind: w.kind,
        configured: true,
        ok: false,
        detail: (err instanceof Error ? err.message : String(err)).slice(0, 200),
      });
    }
  }
  return out;
}
