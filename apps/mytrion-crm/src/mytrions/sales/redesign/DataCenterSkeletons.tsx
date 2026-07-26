/**
 * Data Center cold-load skeletons — Home `ss-skel` language shaped as kanban / list.
 */
import { s } from './dc';

function Skel({ w, h, extra = '' }: { w: string; h: string; extra?: string }) {
  return <div className="ss-skel" style={s(`width:${w};height:${h};border-radius:var(--radius-md);${extra}`)} />;
}

/** Horizontal columns with stacked cards — matches Leads/Deals kanban chrome. */
export function DcKanbanSkeleton({ label }: { label: string }) {
  return (
    <div
      className="ss-fu"
      aria-busy="true"
      aria-label={`Loading ${label} board`}
      style={s('display:flex;gap:14px;overflow:hidden;padding:4px 2px 12px;min-height:420px')}
    >
      {[0, 1, 2, 3, 4].map((col) => (
        <div
          key={col}
          style={s(
            'flex:0 0 264px;display:flex;flex-direction:column;gap:10px;padding:12px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border)',
          )}
        >
          <div style={s('display:flex;align-items:center;justify-content:space-between;gap:8px')}>
            <Skel w="96px" h="12px" />
            <Skel w="28px" h="20px" extra="border-radius:99px" />
          </div>
          {[0, 1, 2].map((c) => (
            <div
              key={c}
              style={s(
                'padding:12px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2);display:flex;flex-direction:column;gap:8px',
              )}
            >
              <Skel w="78%" h="13px" />
              <Skel w="52%" h="11px" />
              <div style={s('display:flex;gap:8px;margin-top:2px')}>
                <Skel w="54px" h="18px" extra="border-radius:99px" />
                <Skel w="40px" h="18px" extra="border-radius:99px" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Table-style rows for Leads/Deals list view. */
export function DcListSkeleton({ label, cols = 5 }: { label: string; cols?: number }) {
  return (
    <div
      className="ss-fu"
      aria-busy="true"
      aria-label={`Loading ${label} list`}
      style={s(
        'border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);overflow:hidden;min-height:360px',
      )}
    >
      <div
        style={s(
          `display:grid;grid-template-columns:repeat(${cols},1fr);gap:12px;padding:14px 18px;border-bottom:1px solid var(--border);background:var(--alt)`,
        )}
      >
        {Array.from({ length: cols }, (_, i) => (
          <Skel key={i} w="70%" h="11px" />
        ))}
      </div>
      {Array.from({ length: 8 }, (_, r) => (
        <div
          key={r}
          style={s(
            `display:grid;grid-template-columns:repeat(${cols},1fr);gap:12px;padding:16px 18px;border-bottom:1px solid var(--border2)`,
          )}
        >
          {Array.from({ length: cols }, (_, c) => (
            <Skel key={c} w={c === 0 ? '85%' : '60%'} h="12px" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Compact rows for related Calls / Notes panels. */
export function DcPanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" style={s('display:flex;flex-direction:column;gap:10px;padding:4px 0')}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={s('display:flex;gap:10px;align-items:center;padding:6px 0;border-top:1px solid var(--border2)')}>
          <Skel w="58px" h="20px" extra="border-radius:99px" />
          <div style={s('flex:1;min-width:0')}>
            <Skel w="72%" h="12px" />
            <Skel w="44%" h="10px" extra="margin-top:6px" />
          </div>
        </div>
      ))}
    </div>
  );
}
