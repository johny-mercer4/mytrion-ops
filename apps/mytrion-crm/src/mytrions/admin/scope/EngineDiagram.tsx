/**
 * Octane Scope — the Lead-Generation automation engine diagram: trigger / intake
 * pipeline → spinning Distribution Engine core → weighted factors → output chip.
 */
import { hexA, ic, type EngineDef } from './model';

export function EngineDiagram({ engine, color }: { engine: EngineDef; color: string }) {
  // No pipeline in the data → a single TRIGGER chip (the distribution engine's input).
  const pipeline = engine.trigger
    ? [{ label: engine.trigger, last: true, iconPath: ic('bolt') }]
    : [];

  return (
    <div style={{ display: 'flex', minHeight: '100%' }}>
      <div style={{ margin: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: '.14em', color: 'var(--sub)' }}>AUTOMATED</span>
          <span style={{ color, border: '1px solid var(--gb)', borderRadius: 3, padding: '2px 7px', fontSize: 9, fontFamily: "'JetBrains Mono',monospace", letterSpacing: '.04em' }}>
            by {engine.by || 'R&D'}
          </span>
        </div>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: '.14em', color: 'var(--sub)', marginBottom: 6 }}>
          {pipeline.length > 1 ? 'INTAKE PIPELINE' : 'TRIGGER'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 9, maxWidth: 680 }}>
          {pipeline.map((p, pi) => (
            <div key={pi} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 9, padding: '11px 15px',
                  background: 'var(--glass)', border: '1px solid var(--gb)', borderRadius: 7,
                  boxShadow: '0 6px 18px rgba(0,0,0,.3)', fontSize: 13, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap',
                }}
              >
                {p.iconPath ? (
                  <span style={{ display: 'flex', width: 24, height: 24, flex: 'none', alignItems: 'center', justifyContent: 'center', color }}>
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d={p.iconPath} />
                    </svg>
                  </span>
                ) : null}
                {p.label}
              </div>
              {!p.last && (
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--sub)', flex: 'none' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              )}
            </div>
          ))}
        </div>
        <div className="oct-varrow">
          <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 5v14M6 13l6 6 6-6" />
          </svg>
        </div>
        <div
          style={{
            position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 128, height: 128, borderRadius: '50%', border: `1.5px solid ${color}`,
            background: hexA(color, 0.1), boxShadow: `0 0 44px ${hexA(color, 0.32)}`,
          }}
        >
          <div className="oct-anim" style={{ position: 'absolute', inset: -11, borderRadius: '50%', border: `1px solid ${hexA(color, 0.4)}`, animation: 'octSpin 9s linear infinite' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ color, display: 'flex', justifyContent: 'center' }}>
              <svg width="26" height="26" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" d={ic('sliders')} />
              </svg>
            </div>
            <div style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--ink)', lineHeight: 1.05, marginTop: 4, maxWidth: 100 }}>
              {engine.engine}
            </div>
          </div>
        </div>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: '.14em', color: 'var(--sub)', margin: '12px 0 8px' }}>WEIGHS</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8, maxWidth: 440 }}>
          {engine.factors.map((f) => (
            <div
              key={f.label}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 11px',
                background: 'var(--glass)', border: `1px solid ${hexA(f.color, 0.45)}`, borderLeft: `3px solid ${f.color}`, borderRadius: 3,
              }}
            >
              <span style={{ display: 'flex', color: f.color, flex: 'none' }}>
                <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d={ic(f.icon)} />
                </svg>
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{f.label}</span>
            </div>
          ))}
        </div>
        <div className="oct-varrow">
          <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 5v14M6 13l6 6 6-6" />
          </svg>
        </div>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: '.14em', color: 'var(--sub)', margin: '2px 0 4px' }}>OUTPUT</div>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 9, padding: '13px 18px',
            background: 'var(--glass)', border: `1px solid ${hexA('#2ECC71', 0.5)}`, borderLeft: '3px solid #2ECC71', borderRadius: 3,
            boxShadow: `0 0 16px ${hexA('#2ECC71', 0.12)}`, backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
          }}
        >
          <span style={{ display: 'flex', color: '#2ECC71', flex: 'none' }}>
            <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d={ic('user')} />
            </svg>
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{engine.output}</span>
        </div>
      </div>
    </div>
  );
}
