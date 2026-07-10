/**
 * Octane Scope — the customer-lifecycle visual map (port of the RnD widget's
 * octane-business panel, with React Flow blueprints). A horizontally-scrolling,
 * draggable, zoomable parallax scene: the Intake road and the After hub, each
 * stage/cycle opening a sub-tabbed drill-down.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { hexA, type CycleDef, type DetailNode } from './model';
import { OCT_STAGES } from './stages';
import { OCT_AFTER_CENTER, OCT_AFTER_W } from './after';
import { computeRoadLayout } from './layout';
import { SCENE_DARK, SCENE_LIGHT, useDocumentTheme } from './scopeTheme';
import { RoadScene } from './RoadScene';
import { AfterHub } from './AfterHub';
import { StageModal } from './StageModal';
import { ScopeToastHost } from './toast';
import './scope-scene.css';
import './scope-detail.css';

type Lifecycle = 'intake' | 'after';

const MONO = "'JetBrains Mono',monospace";

export function OctaneScope() {
  const [lc, setLc] = useState<Lifecycle>('intake');
  const [zoom, setZoom] = useState(1);
  const [activeIndex, setActiveIndex] = useState(0);
  const [openStage, setOpenStage] = useState<number | null>(null);
  const [openCycle, setOpenCycle] = useState<CycleDef | null>(null);
  const [vh, setVh] = useState(760);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const farRef = useRef<HTMLDivElement | null>(null);
  const midRef = useRef<HTMLDivElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const layout = useMemo(() => computeRoadLayout(vh / zoom), [vh, zoom]);

  // Mirrors for imperative handlers (scroll / resize / keys) so they never go stale.
  const stateRef = useRef({ lc, zoom, activeIndex, layout, isOpen: false });
  stateRef.current = { lc, zoom, activeIndex, layout, isOpen: openStage !== null || openCycle !== null };

  const theme = useDocumentTheme();
  const dark = theme !== 'light';
  const t = dark ? SCENE_DARK : SCENE_LIGHT;

  const intake = lc === 'intake';
  const activeStage = OCT_STAGES[Math.min(activeIndex, OCT_STAGES.length - 1)]!;
  const floodHex = intake ? activeStage.color : OCT_AFTER_CENTER.color;
  const worldW = intake ? layout.worldW : OCT_AFTER_W;
  const worldH = layout.worldH;

  const node: DetailNode | null = openCycle ?? (openStage !== null ? OCT_STAGES[openStage] ?? null : null);
  const isOpen = node !== null;
  const showZoom = intake && !isOpen;
  const showRail = intake && !isOpen;

  /* ── camera ── */
  const centerOn = (i: number, smooth: boolean) => {
    const sc = scrollRef.current;
    const p = stateRef.current.layout.points[i];
    if (!sc || !p) return;
    sc.scrollTo({ left: p.x * stateRef.current.zoom - sc.clientWidth / 2, behavior: smooth ? 'smooth' : 'auto' });
  };
  const centerAfter = () => {
    const sc = scrollRef.current;
    if (!sc) return;
    sc.scrollTo({ left: (OCT_AFTER_W * stateRef.current.zoom) / 2 - sc.clientWidth / 2, behavior: 'auto' });
  };

  const updateView = () => {
    const sc = scrollRef.current;
    if (!sc) return;
    const { lc: lcNow, zoom: z, layout: L, activeIndex: ai } = stateRef.current;
    const isIntake = lcNow === 'intake';
    const sl = sc.scrollLeft;
    const vw = sc.clientWidth;
    const cu = (sl + vw / 2) / z;
    const vwu = vw / z;
    const ww = isIntake ? L.worldW : OCT_AFTER_W;
    if (farRef.current) farRef.current.style.transform = `translateX(${-sl * 0.16}px)`;
    if (midRef.current) midRef.current.style.transform = `translateX(${-sl * 0.4}px)`;
    if (glowRef.current) {
      const f = Math.max(0, Math.min(1, cu / ww));
      glowRef.current.style.left = `${20 + f * 40}%`;
    }
    if (!isIntake) return; // After hub has no stage cards / active-stage detection
    const pts = L.points;
    let best = 0;
    let bd = Number.MAX_VALUE;
    pts.forEach((p, i) => {
      const d = Math.abs(p.x - cu);
      if (d < bd) { bd = d; best = i; }
    });
    sc.querySelectorAll<HTMLElement>('[data-stage-card]').forEach((c) => {
      const i = Number(c.dataset['idx']);
      const p = pts[i];
      if (!p) return;
      const d = Math.abs(p.x - cu);
      const tt = Math.min(d / (vwu * 0.6), 1);
      c.style.opacity = (1 - 0.5 * tt).toFixed(3);
      c.style.zIndex = String(200 - Math.round(d / 10));
    });
    if (best !== ai) setActiveIndex(best);
  };

  const onScroll = () => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      updateView();
    });
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    const sc = scrollRef.current;
    if (!sc) return;
    if ((e.target as HTMLElement).closest('[data-stage-card]')) return;
    const startX = e.clientX;
    const startL = sc.scrollLeft;
    sc.style.cursor = 'grabbing';
    const move = (ev: PointerEvent) => { sc.scrollLeft = startL - (ev.clientX - startX); };
    const up = () => {
      sc.style.cursor = 'grab';
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /* ── navigation ── */
  const focusStage = (i: number) => centerOn(i, true);
  const closeDetail = () => { setOpenStage(null); setOpenCycle(null); };
  const switchLifecycle = (id: Lifecycle) => { setLc(id); closeDetail(); };

  const handleOpenStage = (i: number) => {
    const s = OCT_STAGES[i];
    if (!s) return;
    if (s.terminal) { switchLifecycle('after'); return; } // Client Stage → After lifecycle
    centerOn(i, true);
    setOpenCycle(null);
    setOpenStage(i);
  };

  const zoomBy = (d: number) => setZoom((z) => Math.max(0.5, Math.min(1.8, Math.round((z + d) * 100) / 100)));

  /* ── mount: size, resize, wheel (non-passive), keyboard ── */
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    setVh(sc.clientHeight || 760);

    const ro = new ResizeObserver(() => {
      setVh(sc.clientHeight || 760);
      requestAnimationFrame(() => {
        if (stateRef.current.lc === 'intake') centerOn(stateRef.current.activeIndex, false);
        else centerAfter();
        updateView();
      });
    });
    ro.observe(sc);

    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        sc.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    };
    sc.addEventListener('wheel', onWheel, { passive: false });

    const onKey = (e: KeyboardEvent) => {
      const st = stateRef.current;
      if (e.key === 'Escape' && st.isOpen) closeDetail();
      else if (!st.isOpen && st.lc === 'intake' && e.key === 'ArrowRight') centerOn(Math.min(st.activeIndex + 1, OCT_STAGES.length - 1), true);
      else if (!st.isOpen && st.lc === 'intake' && e.key === 'ArrowLeft') centerOn(Math.max(st.activeIndex - 1, 0), true);
    };
    document.addEventListener('keydown', onKey);

    return () => {
      ro.disconnect();
      sc.removeEventListener('wheel', onWheel);
      document.removeEventListener('keydown', onKey);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Recenter the camera whenever the world changes (zoom, resize, lifecycle switch). */
  useLayoutEffect(() => {
    requestAnimationFrame(() => {
      if (stateRef.current.lc === 'intake') centerOn(stateRef.current.activeIndex, false);
      else centerAfter();
      updateView();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, lc]);

  const rootStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    background: t.bg0,
    fontFamily: "'Inter',system-ui,sans-serif",
    color: t.ink,
    overflow: 'hidden',
    WebkitFontSmoothing: 'antialiased',
    userSelect: 'none',
    ...({
      '--bg0': t.bg0,
      '--bg1': t.bg1,
      '--ink': t.ink,
      '--sub': t.sub,
      '--line': t.line,
      '--glass': t.glass,
      '--gb': t.gb,
      '--haze': t.haze,
      '--noteglass': t.noteglass,
      '--flood': hexA(floodHex, dark ? 0.3 : 0.16),
      '--liveColor': floodHex,
      '--scrim': dark ? 'rgba(2,4,9,.78)' : 'rgba(20,28,45,.5)',
    } as CSSProperties),
  };

  return (
    <div className="oct-host">
      <div className="oct-root" style={rootStyle}>
        {/* FAR layer: drifting grid + terrain */}
        <div ref={farRef} style={{ position: 'absolute', inset: '-10% -20%', zIndex: 1, willChange: 'transform', pointerEvents: 'none' }}>
          <div
            className="oct-anim"
            style={{
              position: 'absolute', inset: 0,
              backgroundImage: 'linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px)',
              backgroundSize: '64px 64px,64px 64px',
              WebkitMaskImage: 'radial-gradient(120% 90% at 50% 40%,#000 30%,transparent 80%)',
              maskImage: 'radial-gradient(120% 90% at 50% 40%,#000 30%,transparent 80%)',
              opacity: 0.5,
              animation: 'octDrift 60s linear infinite',
            }}
          />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: '-6%', height: '46%', background: 'linear-gradient(to top,var(--haze),transparent)' }} />
        </div>

        {/* MID layer: ambient color flood */}
        <div ref={midRef} style={{ position: 'absolute', inset: '-15% -25%', zIndex: 2, willChange: 'transform', pointerEvents: 'none' }}>
          <div
            ref={glowRef}
            style={{
              position: 'absolute', left: '38%', top: '50%', width: 1100, height: 1100,
              transform: 'translate(-50%,-50%)', borderRadius: '50%',
              background: 'radial-gradient(circle,var(--flood) 0%,transparent 62%)',
              opacity: 0.5, filter: 'blur(20px)', transition: 'background 1.1s ease,left 1.1s ease',
            }}
          />
        </div>

        {/* vignette */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none', background: 'radial-gradient(130% 100% at 50% 46%,transparent 52%,rgba(0,0,0,.55) 100%)' }} />

        {/* SCROLLER (the camera) */}
        <div
          ref={scrollRef}
          className="oct-scroll"
          onScroll={onScroll}
          onPointerDown={onPointerDown}
          style={{ position: 'absolute', inset: 0, zIndex: 5, overflowX: 'auto', overflowY: 'hidden', cursor: 'grab' }}
        >
          <div style={{ position: 'relative', height: '100%', width: worldW * zoom }}>
            <div style={{ position: 'absolute', left: 0, top: 0, width: worldW, height: worldH, transform: `scale(${zoom})`, transformOrigin: '0 0' }}>
              {intake ? (
                <RoadScene layout={layout} onOpenStage={handleOpenStage} />
              ) : (
                <AfterHub worldH={worldH} onOpenCycle={(c) => { setOpenStage(null); setOpenCycle(c); }} />
              )}
            </div>
          </div>
        </div>

        {/* TOP HUD */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 7, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '22px 26px', pointerEvents: 'none' }}>
          <div style={{ pointerEvents: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <div style={{ width: 11, height: 11, background: 'var(--liveColor)', borderRadius: '50%', boxShadow: '0 0 12px var(--liveColor)', transition: 'background .9s,box-shadow .9s' }} />
              <div style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 21, letterSpacing: '.13em', color: 'var(--ink)' }}>OCTANE SCOPE</div>
            </div>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '.1em', color: 'var(--sub)', marginTop: 5, marginLeft: 22 }}>
              CUSTOMER LIFECYCLE — VISUAL MAP
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, pointerEvents: 'auto', background: 'var(--glass)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', border: '1px solid var(--gb)', borderRadius: 4, padding: 4 }}>
            {([{ id: 'intake', name: 'Intake Lifecycle' }, { id: 'after', name: 'After Lifecycle' }] as const).map((tb) => {
              const on = tb.id === lc;
              return (
                <button
                  key={tb.id}
                  type="button"
                  onClick={() => switchLifecycle(tb.id)}
                  style={{
                    border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 12.5, padding: '8px 15px', borderRadius: 3,
                    background: on ? 'var(--ink)' : 'transparent', color: on ? 'var(--bg0)' : 'var(--sub)', letterSpacing: '.01em', transition: 'all .2s',
                  }}
                >
                  {tb.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* ZOOM controls */}
        {showZoom && (
          <div className="oct-zoom">
            <button type="button" className="oct-zoom__btn" onClick={() => zoomBy(0.2)} title="Zoom in" aria-label="Zoom in">
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5v14M5 12h14" /></svg>
            </button>
            <button type="button" className="oct-zoom__btn oct-zoom__pct" onClick={() => setZoom(1)} title="Reset zoom" aria-label="Reset zoom">
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" className="oct-zoom__btn" onClick={() => zoomBy(-0.2)} title="Zoom out" aria-label="Zoom out">
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12h14" /></svg>
            </button>
          </div>
        )}

        {/* BOTTOM progress rail (hidden while a stage is open) */}
        {showRail && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px 26px', pointerEvents: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: 'var(--glass)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', border: '1px solid var(--gb)', borderRadius: 4, padding: '9px 12px', pointerEvents: 'auto' }}>
              <button type="button" className="oct-navbtn" onClick={() => focusStage(Math.max(activeIndex - 1, 0))} aria-label="Previous stage" style={{ border: 'none', background: 'transparent', color: 'var(--sub)', cursor: 'pointer', display: 'flex', padding: 6, borderRadius: 3 }}>
                <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 10px' }}>
                {OCT_STAGES.map((s, i) => {
                  const on = i === activeIndex;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => focusStage(i)}
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, padding: 0, width: on ? 'auto' : 9, transition: 'width .35s ease' }}
                    >
                      <span style={{ height: 9, width: 9, borderRadius: '50%', background: on ? s.color : hexA(s.color, 0.45), boxShadow: on ? `0 0 12px ${s.color}` : 'none', transition: 'all .35s ease' }} />
                      <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.06em', whiteSpace: 'nowrap', color: on ? 'var(--ink)' : 'transparent', opacity: on ? 1 : 0, transition: 'opacity .35s,color .35s' }}>
                        {s.short}
                      </span>
                    </button>
                  );
                })}
              </div>
              <button type="button" className="oct-navbtn" onClick={() => focusStage(Math.min(activeIndex + 1, OCT_STAGES.length - 1))} aria-label="Next stage" style={{ border: 'none', background: 'transparent', color: 'var(--sub)', cursor: 'pointer', display: 'flex', padding: 6, borderRadius: 3 }}>
                <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
              </button>
            </div>
          </div>
        )}

        {/* DRILL-DOWN overlay */}
        {node && <StageModal key={node.id} node={node} onClose={closeDetail} />}

        <ScopeToastHost />
      </div>
    </div>
  );
}
