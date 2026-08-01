/**
 * Cold-load skeleton for My Tasks — hero metrics + 4 status columns (matches live board chrome).
 */
import { s } from './dc';

function Skel({ w, h, extra = '' }: { w: string; h: string; extra?: string }) {
  return <div className="ss-skel" style={s(`width:${w};height:${h};border-radius:var(--radius-md);${extra}`)} />;
}

export function TasksBoardSkeleton() {
  return (
    <div className="ss-fu ss-tasks-skel" aria-busy="true" aria-label="Loading My Tasks board">
      <div className="ss-ret-hero">
        <div style={s('display:flex;align-items:flex-end;justify-content:space-between;gap:16px')}>
          <div style={s('flex:1;min-width:0;display:flex;flex-direction:column;gap:8px')}>
            <Skel w="110px" h="26px" extra="border-radius:99px" />
            <Skel w="160px" h="28px" />
            <Skel w="320px" h="14px" />
          </div>
          <Skel w="96px" h="36px" />
        </div>
        <div className="ss-ret-metrics" style={{ marginTop: 8 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="ss-ret-metric">
              <Skel w="54px" h="11px" />
              <Skel w="40px" h="22px" extra="margin-top:6px" />
              <Skel w="72px" h="10px" extra="margin-top:6px" />
            </div>
          ))}
        </div>
      </div>

      <div className="ss-scroll ss-ret-board ss-tasks-board" style={s('margin-top:16px')}>
        {[0, 1, 2, 3].map((col) => (
          <div key={col} className="ss-ret-col">
            <div className="ss-ret-col-head">
              <div style={s('display:flex;flex-direction:column;gap:6px')}>
                <Skel w="88px" h="12px" />
                <Skel w="64px" h="10px" />
              </div>
              <Skel w="36px" h="28px" />
            </div>
            <div className="ss-ret-col-body">
              {[0, 1, 2].map((card) => (
                <div
                  key={card}
                  style={s(
                    'padding:12px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);display:flex;flex-direction:column;gap:8px',
                  )}
                >
                  <Skel w="82%" h="13px" />
                  <Skel w="48%" h="11px" />
                  <Skel w="56%" h="11px" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
