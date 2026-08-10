import { s } from '../dc';

function Skel({ w, h, extra = '' }: { w: string; h: string; extra?: string }) {
  return <div className="ss-skel" style={s(`width:${w};height:${h};border-radius:var(--radius-md);${extra}`)} />;
}

/** Per-block skeletons for the progressive Home (cold-cache only). */
export function AnnouncementsRailSkeleton() {
  return (
    <div style={s('display:flex;gap:12px;overflow:hidden;padding-bottom:6px')} aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} style={s('flex:0 0 300px;display:flex;gap:12px;padding:15px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border)')}>
          <Skel w="40px" h="40px" />
          <div style={s('flex:1;min-width:0')}>
            <Skel w="85%" h="13px" />
            <Skel w="40%" h="11px" extra="margin-top:8px" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SnapshotCardsSkeleton() {
  return (
    <div aria-busy="true">
      {[0, 1, 2].map((g) => (
        <div key={g} style={s('margin-bottom:16px')}>
          <Skel w="90px" h="11px" extra="margin-bottom:10px" />
          <div style={s('display:grid;grid-template-columns:repeat(4, minmax(0, 1fr));gap:12px')}>
            {[0, 1, 2, 3].map((c) => (
              <div key={c} style={s('padding:15px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)')}>
                <Skel w="36px" h="36px" />
                <Skel w="64px" h="22px" extra="margin-top:12px" />
                <Skel w="72%" h="12px" extra="margin-top:8px" />
                <Skel w="90%" h="10px" extra="margin-top:6px" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function InboxListSkeleton() {
  return (
    <div style={s('display:flex;flex-direction:column;gap:10px')} aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} style={s('display:flex;gap:12px;padding:13px 14px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border)')}>
          <Skel w="34px" h="34px" />
          <div style={s('flex:1')}>
            <Skel w="70%" h="12px" />
            <Skel w="90%" h="11px" extra="margin-top:8px" />
          </div>
        </div>
      ))}
    </div>
  );
}
