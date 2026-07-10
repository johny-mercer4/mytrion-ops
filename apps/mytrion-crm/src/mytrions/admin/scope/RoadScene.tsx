/**
 * Octane Scope — the Intake road: a glowing gradient spline with pulsing stage orbs,
 * tethered floating glass stage cards, flowing particles and the WEX ⇄ Deal
 * interconnect arc. Card opacity / parallax / active-stage detection are driven
 * imperatively by the scene root on scroll (data-stage-card hooks).
 */
import type { CSSProperties } from 'react';
import { deptColor, hexA, ic } from './model';
import { OCT_STAGES } from './stages';
import type { RoadLayout } from './layout';

const PARTICLE_SEEDS = [
  { size: 6, dur: 7, delay: 0, color: '#00BFFF' },
  { size: 5, dur: 9, delay: 1.6, color: '#8B5CF6' },
  { size: 7, dur: 8, delay: 3, color: '#F97316' },
  { size: 5, dur: 10, delay: 4.4, color: '#14B8A6' },
  { size: 6, dur: 7.5, delay: 5.5, color: '#2ECC71' },
  { size: 4, dur: 11, delay: 2.2, color: '#E8EDF6' },
];

export function RoadScene({ layout, onOpenStage }: { layout: RoadLayout; onOpenStage: (i: number) => void }) {
  return (
    <>
      {/* ROAD */}
      <svg
        width={layout.worldW}
        height={layout.worldH}
        viewBox={`0 0 ${layout.worldW} ${layout.worldH}`}
        style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
      >
        <defs>
          <linearGradient id="octRoad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#00BFFF" />
            <stop offset="27%" stopColor="#8B5CF6" />
            <stop offset="52%" stopColor="#F97316" />
            <stop offset="77%" stopColor="#14B8A6" />
            <stop offset="100%" stopColor="#2ECC71" />
          </linearGradient>
        </defs>
        <path d={layout.pathD} fill="none" stroke="url(#octRoad)" strokeWidth={20} strokeLinecap="round" opacity={0.16} style={{ filter: 'blur(11px)' }} />
        <path d={layout.pathD} fill="none" stroke="var(--bg1)" strokeWidth={11} strokeLinecap="round" opacity={0.9} />
        <path d={layout.pathD} fill="none" stroke="url(#octRoad)" strokeWidth={2.4} strokeLinecap="round" opacity={0.85} />
        <path
          className="oct-flowline oct-anim"
          d={layout.pathD}
          fill="none"
          stroke="url(#octRoad)"
          strokeWidth={4.5}
          strokeLinecap="round"
          strokeDasharray="26 56"
          opacity={0.95}
          style={{ animation: 'octDash 3.2s linear infinite', filter: 'drop-shadow(0 0 6px var(--flood))' }}
        />
        {layout.stems.map((st, i) => (
          <line key={`st${i}`} x1={st.x1} y1={st.y1} x2={st.x2} y2={st.y2} stroke={st.color} strokeWidth={1.4} strokeDasharray="2 5" opacity={0.5} />
        ))}
        {layout.interconnects.map((icn, i) => (
          <path
            key={`ic${i}`}
            className="oct-flowline oct-anim"
            d={icn.path}
            fill="none"
            stroke={icn.color}
            strokeWidth={2}
            strokeDasharray="6 7"
            strokeLinecap="round"
            opacity={0.85}
            style={{ animation: 'octDash 3s linear infinite' }}
          />
        ))}
      </svg>

      {/* interconnect label pill */}
      {layout.interconnects.map((icn, i) => (
        <div key={`icl${i}`} className="oct-ic-label" style={{ left: icn.midX, top: icn.midY, '--c': icn.color } as CSSProperties}>
          <svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4" />
          </svg>
          INTERCONNECTED
        </div>
      ))}

      {/* particles */}
      {PARTICLE_SEEDS.map((p, i) => (
        <div
          key={`p${i}`}
          className="oct-particle oct-anim"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: p.size,
            height: p.size,
            borderRadius: '50%',
            background: p.color,
            boxShadow: `0 0 10px 2px ${p.color}`,
            offsetPath: `path('${layout.pathD}')`,
            offsetRotate: '0deg',
            offsetAnchor: '50% 50%',
            animation: `octFlowMove ${p.dur}s linear infinite`,
            animationDelay: `${p.delay}s`,
            opacity: 0.9,
          }}
        />
      ))}

      {/* stage orbs */}
      {OCT_STAGES.map((s, i) => {
        const p = layout.points[i]!;
        return (
          <div key={`orb${s.id}`} style={{ position: 'absolute', left: p.x, top: p.y, transform: 'translate(-50%,-50%)' }}>
            <div
              className="oct-anim"
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: 46,
                height: 46,
                borderRadius: '50%',
                border: `1.5px solid ${s.color}`,
                animation: 'octRing 2.8s ease-out infinite',
              }}
            />
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: s.color,
                boxShadow: `0 0 16px 3px ${s.color}`,
                border: '2px solid var(--bg0)',
              }}
            />
          </div>
        );
      })}

      {/* stage CARDS */}
      {OCT_STAGES.map((s, i) => {
        const c = layout.cards[i]!;
        const tint = hexA(s.color, 0.12);
        const dots = s.departments.slice(0, 4).map((d) => deptColor(d));
        return (
          <div
            key={`card${s.id}`}
            data-stage-card="1"
            data-idx={i}
            className="oct-anim"
            onClick={() => onOpenStage(i)}
            style={{
              position: 'absolute',
              left: c.x,
              top: c.y,
              transform: 'translate(-50%,-50%)',
              width: 264,
              animation: 'octFloat 7s ease-in-out infinite',
              animationDelay: `${(i * 0.6).toFixed(1)}s`,
              cursor: 'pointer',
              willChange: 'transform,opacity',
            }}
          >
            <div
              style={{
                position: 'relative',
                background: 'var(--glass)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: '1px solid var(--gb)',
                borderTop: `2px solid ${s.color}`,
                borderRadius: 3,
                padding: '18px 18px 15px',
                boxShadow: '0 24px 50px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.02) inset',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, letterSpacing: '.18em', color: s.color, textTransform: 'uppercase' }}>
                  STAGE {String(s.num).padStart(2, '0')}
                </div>
                <div style={{ display: 'flex', width: 34, height: 34, alignItems: 'center', justifyContent: 'center', border: `1px solid ${s.color}`, borderRadius: 3, color: s.color, background: tint }}>
                  <svg width="17" height="17" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d={ic(s.icon)} />
                  </svg>
                </div>
              </div>
              <div style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 25, lineHeight: 1.05, marginTop: 8, color: 'var(--ink)', letterSpacing: '.01em' }}>
                {s.title}
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--sub)', marginTop: 7, textWrap: 'pretty', minHeight: 36 }}>{s.desc}</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                  {dots.map((color, di) => (
                    <span key={di} style={{ width: 9, height: 9, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}` }} />
                  ))}
                  <span style={{ fontSize: 10.5, color: 'var(--sub)', marginLeft: 4, fontFamily: "'JetBrains Mono',monospace" }}>
                    {s.departments.length ? `${s.departments.length} depts` : 'destination'}
                  </span>
                </div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: '.12em', color: s.color, display: 'flex', alignItems: 'center', gap: 4 }}>
                  OPEN
                  <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
