import { s } from '../dc';

function Skel({ w, h, extra = '' }: { w: string; h: string; extra?: string }) {
  return <div className="ss-skel" style={s(`width:${w};height:${h};border-radius:var(--radius-md);${extra}`)} />;
}

/** Full Home gate — hero + habit strip + below-fold, shown until primary fetches settle. */
export function HomePageSkeleton() {
  return (
    <div className="ss-fu" aria-busy="true" aria-label="Loading homepage">
      <div style={s('display:grid;grid-template-columns:1.35fr 1fr;gap:18px;margin-bottom:18px')}>
        <div
          style={s(
            'position:relative;overflow:hidden;border-radius:var(--radius-md);padding:26px 28px;background:linear-gradient(120deg, rgba(var(--accent-rgb),.14), rgba(var(--violet-rgb),.10)), var(--surface);border:1px solid var(--border)',
          )}
        >
          <Skel w="120px" h="12px" />
          <Skel w="72%" h="30px" extra="margin-top:12px" />
          <Skel w="90px" h="11px" extra="margin-top:22px" />
          <Skel w="100%" h="9px" extra="margin-top:10px;border-radius:99px" />
          <Skel w="200px" h="11px" extra="margin-top:10px" />
          <Skel w="140px" h="38px" extra="margin-top:18px" />
        </div>
        <div
          style={s(
            'border-radius:var(--radius-md);padding:22px 24px;background:var(--surface);border:1px solid var(--border);display:flex;flex-direction:column;justify-content:center',
          )}
        >
          <div style={s('display:flex;justify-content:space-between')}>
            <Skel w="110px" h="11px" />
            <Skel w="64px" h="12px" />
          </div>
          <Skel w="100%" h="9px" extra="margin:18px 0 12px;border-radius:99px" />
          <div style={s('display:flex;justify-content:space-between')}>
            <Skel w="48px" h="11px" />
            <Skel w="72px" h="11px" />
            <Skel w="48px" h="11px" />
          </div>
        </div>
      </div>
      <div style={s('display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px')}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={s(
              'display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border)',
            )}
          >
            <Skel w="38px" h="38px" />
            <div style={s('flex:1')}>
              <Skel w="42px" h="22px" />
              <Skel w="70px" h="11px" extra="margin-top:6px" />
            </div>
          </div>
        ))}
      </div>
      <HomeBelowFoldSkeleton />
    </div>
  );
}

/** Below-fold homepage skeleton — matches announcements / snapshot / activity / inbox shapes. */
export function HomeBelowFoldSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading homepage">
      <div style={s('display:flex;align-items:center;justify-content:space-between;margin:22px 2px 12px')}>
        <Skel w="220px" h="16px" />
        <Skel w="52px" h="20px" extra="border-radius:99px" />
      </div>
      <div style={s('display:flex;gap:12px;overflow:hidden;padding-bottom:6px')}>
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

      <div style={s('margin-top:24px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);overflow:hidden')}>
        <div style={s('display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border)')}>
          <Skel w="150px" h="15px" />
          <Skel w="90px" h="12px" />
        </div>
        <div style={s('padding:18px 20px')}>
          {[0, 1, 2].map((g) => (
            <div key={g} style={s('margin-bottom:16px')}>
              <Skel w="90px" h="11px" extra="margin-bottom:10px" />
              <div style={s('display:grid;grid-template-columns:repeat(4,1fr);gap:12px')}>
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
      </div>

      <div style={s('margin-top:18px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);overflow:hidden')}>
        <div style={s('display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border)')}>
          <Skel w="120px" h="15px" />
          <Skel w="160px" h="28px" />
        </div>
        <div style={s('padding:18px 20px')}>
          <div style={s('display:grid;grid-template-columns:repeat(7,1fr);gap:11px')}>
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} style={s('padding:13px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2);text-align:center')}>
                <Skel w="32px" h="32px" extra="margin:0 auto" />
                <Skel w="36px" h="18px" extra="margin:9px auto 0" />
                <Skel w="48px" h="10px" extra="margin:6px auto 0" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px')}>
        <div>
          <Skel w="140px" h="15px" extra="margin:0 2px 12px" />
          <div style={s('display:flex;flex-direction:column;gap:12px')}>
            {[0, 1].map((i) => (
              <div key={i} style={s('padding:16px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border)')}>
                <Skel w="70px" h="18px" />
                <Skel w="55%" h="14px" extra="margin-top:10px" />
                <Skel w="90%" h="12px" extra="margin-top:8px" />
              </div>
            ))}
          </div>
        </div>
        <div>
          <Skel w="130px" h="15px" extra="margin:0 2px 12px" />
          <div style={s('display:flex;flex-direction:column;gap:10px')}>
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
        </div>
      </div>
    </div>
  );
}

export function ActivityTilesSkeleton() {
  return (
    <div style={s('display:grid;grid-template-columns:repeat(7,1fr);gap:11px')}>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} style={s('padding:13px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2);text-align:center')}>
          <Skel w="32px" h="32px" extra="margin:0 auto" />
          <Skel w="36px" h="18px" extra="margin:9px auto 0" />
          <Skel w="48px" h="10px" extra="margin:6px auto 0" />
        </div>
      ))}
    </div>
  );
}
