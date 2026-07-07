/**
 * Octane Scope — the After lifecycle: a Client hub with connected cycle cards
 * (Verification / Retention / Customer Service / Billing, and Collection hanging
 * off Billing). Spokes are edge-trimmed gradient beziers with a dash-flow pulse.
 */
import { blueprintsOf, hexA, ic, type CycleDef } from './model';
import { OCT_AFTER_CENTER, OCT_AFTER_CYCLES, OCT_AFTER_W } from './after';
import { computeHubLayout } from './layout';

export function AfterHub({ worldH, onOpenCycle }: { worldH: number; onOpenCycle: (c: CycleDef) => void }) {
  const hub = computeHubLayout(OCT_AFTER_W, worldH);
  const center = OCT_AFTER_CENTER;

  return (
    <>
      <svg
        width={OCT_AFTER_W}
        height={worldH}
        viewBox={`0 0 ${OCT_AFTER_W} ${worldH}`}
        style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
      >
        <defs>
          {hub.lines.map((l, i) => (
            <linearGradient key={`g${i}`} id={`octSpoke${i}`} gradientUnits="userSpaceOnUse" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}>
              <stop offset="0%" stopColor={l.fromColor} />
              <stop offset="100%" stopColor={l.color} />
            </linearGradient>
          ))}
        </defs>
        {hub.lines.map((l, i) => (
          <g key={`sp${i}`}>
            <path d={l.path} fill="none" stroke={`url(#octSpoke${i})`} strokeWidth={13} strokeLinecap="round" opacity={0.16} style={{ filter: 'blur(8px)' }} />
            <path d={l.path} fill="none" stroke={`url(#octSpoke${i})`} strokeWidth={2.2} strokeLinecap="round" opacity={0.85} />
            <path
              className="oct-flowline oct-anim"
              d={l.path}
              fill="none"
              stroke={`url(#octSpoke${i})`}
              strokeWidth={4}
              strokeDasharray="22 50"
              strokeLinecap="round"
              opacity={0.95}
              style={{ animation: 'octDash 3.2s linear infinite', filter: `drop-shadow(0 0 6px ${l.color})` }}
            />
          </g>
        ))}
      </svg>

      {/* Client center orb */}
      <div
        style={{
          position: 'absolute',
          left: hub.cx,
          top: hub.cy,
          transform: 'translate(-50%,-50%)',
          width: 150,
          height: 150,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          borderRadius: '50%',
          border: `1.5px solid ${center.color}`,
          background: `radial-gradient(circle,${hexA(center.color, 0.18)},var(--glass))`,
          boxShadow: `0 0 60px ${hexA(center.color, 0.4)}`,
        }}
      >
        <div
          className="oct-anim"
          style={{ position: 'absolute', inset: -12, borderRadius: '50%', border: `1px solid ${hexA(center.color, 0.4)}`, animation: 'octSpin 16s linear infinite' }}
        />
        <div style={{ display: 'flex', color: center.color }}>
          <svg width="34" height="34" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d={ic(center.icon)} />
          </svg>
        </div>
        <div style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 18, letterSpacing: '.05em', color: 'var(--ink)' }}>{center.label}</div>
      </div>

      {/* cycle cards */}
      {OCT_AFTER_CYCLES.map((c, i) => {
        const p = hub.posMap[c.id]!;
        const hasDetail = !!(blueprintsOf(c).length || (c.autos && c.autos.length) || c.departments.length);
        const afterLabel = c.from === 'billing' ? 'after Billing' : '';
        return (
          <div
            key={c.id}
            className="oct-anim"
            onClick={() => { if (hasDetail) onOpenCycle(c); }}
            style={{
              position: 'absolute',
              left: p.x,
              top: p.y,
              transform: 'translate(-50%,-50%)',
              width: 214,
              animation: 'octFloat 7s ease-in-out infinite',
              animationDelay: `${(i * 0.45).toFixed(2)}s`,
              willChange: 'transform',
              cursor: hasDetail ? 'pointer' : 'default',
            }}
          >
            <div
              style={{
                position: 'relative',
                background: 'var(--glass)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: '1px solid var(--gb)',
                borderTop: `2px solid ${c.color}`,
                borderRadius: 6,
                padding: '15px 16px',
                boxShadow: '0 22px 46px rgba(0,0,0,.5)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <div
                  style={{ display: 'flex', width: 32, height: 32, alignItems: 'center', justifyContent: 'center', border: `1px solid ${c.color}`, borderRadius: 6, color: c.color, background: hexA(c.color, 0.12) }}
                >
                  <svg width="17" height="17" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d={ic(c.icon)} />
                  </svg>
                </div>
                <div style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 15, lineHeight: 1.12, color: 'var(--ink)' }}>{c.label}</div>
              </div>
              <div style={{ marginTop: 11, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 7 }}>
                {afterLabel ? (
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 8, letterSpacing: '.06em', color: 'var(--sub)' }}>{afterLabel}</span>
                ) : (
                  <span />
                )}
                {hasDetail ? (
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: '.12em', color: c.color, display: 'flex', alignItems: 'center', gap: 4 }}>
                    OPEN
                    <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M9 5l7 7-7 7" />
                    </svg>
                  </span>
                ) : (
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 8, letterSpacing: '.12em', color: 'var(--sub)', border: '1px solid var(--gb)', borderRadius: 3, padding: '2px 6px' }}>
                    SOON
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
