/**
 * Octane Scope — drill-down overlay for an intake stage or After cycle, with
 * sub-tabs: Blueprint (React Flow graphs) / Departments / Automations / Details.
 */
import { useState, type CSSProperties } from 'react';
import { ScopeBlueprint } from './Blueprint';
import { EngineDiagram } from './EngineDiagram';
import { DetailsTab } from './DetailsTab';
import { blueprintsOf, deptColor, hexA, hideLogoTile, ic, platVM, type DetailNode } from './model';

interface SubTab {
  id: 'blueprint' | 'departments' | 'automations' | 'details';
  name: string;
}

export function StageModal({ node, onClose }: { node: DetailNode; onClose: () => void }) {
  const bps = blueprintsOf(node);
  const [openTab, setOpenTab] = useState<SubTab['id']>(
    node.engine || bps.length ? 'blueprint' : node.departments.length ? 'departments' : 'details',
  );
  const [bpIndex, setBpIndex] = useState(0);
  const [deptExpanded, setDeptExpanded] = useState<Record<number, boolean>>({});

  const subtabs: SubTab[] = [];
  if (bps.length) subtabs.push({ id: 'blueprint', name: 'Blueprint' });
  if (node.departments.length) subtabs.push({ id: 'departments', name: 'Departments' });
  if ((node.autos && node.autos.length) || node.engine) subtabs.push({ id: 'automations', name: 'Automations' });
  subtabs.push({ id: 'details', name: 'Details' });

  const kicker = node.num != null ? `STAGE ${String(node.num).padStart(2, '0')}` : 'AFTER LIFECYCLE';
  const currentBp = bps[Math.min(bpIndex, bps.length - 1)];

  return (
    <>
      <div
        onClick={onClose}
        className="oct-anim"
        style={{
          position: 'absolute', inset: 0, zIndex: 20, background: 'var(--scrim)',
          backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', animation: 'octFade .3s ease',
        }}
      />
      <div
        className="oct-anim"
        style={{
          position: 'absolute', inset: 0, zIndex: 21, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 18, pointerEvents: 'none', animation: 'octZoomIn .42s cubic-bezier(.2,.8,.2,1)', transformOrigin: 'center',
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={node.title}
          style={{
            position: 'relative', width: '100%', height: '100%', maxWidth: 1680,
            background: 'linear-gradient(160deg,var(--bg1),var(--bg0))',
            border: '1px solid var(--gb)', borderTop: `3px solid ${node.color}`, borderRadius: 4,
            boxShadow: '0 50px 120px rgba(0,0,0,.7),0 0 0 1px rgba(255,255,255,.03) inset',
            overflow: 'hidden', pointerEvents: 'auto', display: 'flex', flexDirection: 'column',
          }}
        >
          <div
            style={{
              position: 'absolute', left: '-10%', top: '-30%', width: '60%', height: '90%',
              background: `radial-gradient(circle,${hexA(node.color, 0.22)},transparent 65%)`, pointerEvents: 'none',
            }}
          />

          {/* header */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 26px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div
                style={{
                  display: 'flex', width: 48, height: 48, alignItems: 'center', justifyContent: 'center',
                  border: `1px solid ${node.color}`, borderRadius: 4, color: node.color, background: hexA(node.color, 0.12),
                }}
              >
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d={ic(node.icon)} />
                </svg>
              </div>
              <div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, letterSpacing: '.18em', color: node.color }}>{kicker}</div>
                <div style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 30, lineHeight: 1.05, color: 'var(--ink)' }}>{node.title}</div>
              </div>
            </div>
            <button
              type="button"
              className="oct-close"
              onClick={onClose}
              aria-label="Close"
              style={{ border: '1px solid var(--gb)', background: 'transparent', color: 'var(--sub)', cursor: 'pointer', display: 'flex', padding: 10, borderRadius: 3 }}
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* sub-tabs */}
          <div className="oct-subtabs">
            {subtabs.map((tb) => (
              <button
                key={tb.id}
                type="button"
                className={`oct-subtab ${openTab === tb.id ? 'active' : ''}`}
                onClick={() => setOpenTab(tb.id)}
              >
                {tb.name}
              </button>
            ))}
          </div>

          {/* content */}
          <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
            {openTab === 'blueprint' && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
                {bps.length > 1 && (
                  <div className="oct-bp-switch">
                    {bps.map((b, bi) => (
                      <button
                        key={bi}
                        type="button"
                        className={`oct-bp-switch__btn ${bpIndex === bi ? 'active' : ''}`}
                        onClick={() => setBpIndex(bi)}
                      >
                        {b.name}
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
                  {currentBp ? (
                    <ScopeBlueprint key={`${node.id}-${bpIndex}`} flow={currentBp.flow} accent={node.color} />
                  ) : (
                    <div className="oct-bp-empty">This blueprint isn&apos;t mapped yet.</div>
                  )}
                </div>
              </div>
            )}

            {openTab === 'departments' && (
              <div className="oct-rail" style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: '28px 36px' }}>
                <div className="oct-dept-grid">
                  {node.departments.map((d, di) => {
                    const col = deptColor(d);
                    const platforms = d.platforms.map((p) => platVM(p));
                    return (
                      <div key={di} className="oct-dept-block" style={{ '--d': col } as CSSProperties} onClick={() => setDeptExpanded((prev) => ({ ...prev, [di]: !prev[di] }))}>
                        <div className="oct-dept-block__head">
                          <span className="oct-dept-block__icon">
                            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d={ic(d.icon)} />
                            </svg>
                          </span>
                          <span className="oct-dept-block__name">{d.name}</span>
                          {d.external && (
                            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: '.1em', color: col, border: `1px solid ${col}`, borderRadius: 3, padding: '2px 6px' }}>
                              EXT
                            </span>
                          )}
                          <svg
                            className={`oct-dept-block__chev ${deptExpanded[di] ? 'open' : ''}`}
                            width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                        <div className="oct-dept-block__items">
                          {d.items.map((it, ii) => (
                            <div key={ii} className="oct-dept-block__item">{it}</div>
                          ))}
                        </div>
                        {deptExpanded[di] && (
                          <div className="oct-dept-block__detail oct-anim">
                            <div className="oct-dept-block__detail-label">TOOLS &amp; PLATFORMS</div>
                            {platforms.length ? (
                              <div className="oct-dept-block__logos">
                                {platforms.map((pl, pi) => (
                                  <span key={pi} className="oct-plat oct-dept-chip">
                                    {pl.logo ? (
                                      <span data-logo-tile="1" className="oct-dept-chip__tile">
                                        <img src={pl.logo} alt="" width={15} height={15} onError={hideLogoTile} style={{ display: 'block' }} />
                                      </span>
                                    ) : pl.iconPath ? (
                                      <span style={{ display: 'flex', width: 24, height: 24, flex: 'none', alignItems: 'center', justifyContent: 'center', color: col }}>
                                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d={pl.iconPath} />
                                        </svg>
                                      </span>
                                    ) : (
                                      <span
                                        style={{
                                          display: 'flex', width: 22, height: 22, flex: 'none', alignItems: 'center', justifyContent: 'center',
                                          background: hexA(col, 0.16), borderRadius: 3, fontFamily: "'JetBrains Mono',monospace", fontSize: 8, fontWeight: 600, color: col,
                                        }}
                                      >
                                        {pl.abbr}
                                      </span>
                                    )}
                                    {pl.name}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <div className="oct-dept-block__empty">No specific tools recorded for this cycle.</div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {openTab === 'automations' && (
              <div className="oct-rail" style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: '28px 36px' }}>
                {node.engine ? (
                  <EngineDiagram engine={node.engine} color={node.color} />
                ) : (
                  <>
                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: '.16em', color: 'var(--sub)', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
                      AUTOMATED{' '}
                      <span style={{ color: node.color, border: '1px solid var(--gb)', borderRadius: 3, padding: '2px 7px', fontSize: 9 }}>
                        by {node.autoBy ?? 'R&D'}
                      </span>
                    </div>
                    <div className="oct-auto-grid">
                      {(node.autos ?? []).map((a, ai) => (
                        <div key={ai} className="oct-rule" style={{ '--c': node.color } as CSSProperties}>
                          <div className="oct-rule__head">
                            <span className="oct-rule__icon">
                              <svg width="17" height="17" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d={ic(a.icon)} />
                              </svg>
                            </span>
                            <span className="oct-rule__title">{a.title || a.text}</span>
                            <span className="oct-rule__badge">{a.code || 'AUTO'}</span>
                          </div>
                          {a.when || a.then ? (
                            <div className="oct-rule__body">
                              <div className="oct-rule__row">
                                <span className="oct-rule__tag oct-rule__tag--when">WHEN</span>
                                <span className="oct-rule__txt">{a.when}</span>
                              </div>
                              <div className="oct-rule__arrow">
                                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 5v14M6 13l6 6 6-6" />
                                </svg>
                              </div>
                              <div className="oct-rule__row">
                                <span className="oct-rule__tag oct-rule__tag--then">THEN</span>
                                <span className="oct-rule__txt">{a.then}</span>
                              </div>
                            </div>
                          ) : a.desc ? (
                            <div className="oct-rule__desc">{a.desc}</div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {openTab === 'details' && <DetailsTab node={node} />}
          </div>
        </div>
      </div>
    </>
  );
}
