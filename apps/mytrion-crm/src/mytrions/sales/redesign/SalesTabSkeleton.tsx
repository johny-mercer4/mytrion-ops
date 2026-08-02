/**
 * Sales Mytrion — the ONE loading visual.
 *
 * Every Sales tab except Home is code-split, so a cold open used to show three states in a row:
 * the shell's spinner (`MytrionPageLoader`) while the chunk downloaded → the tab's own shaped
 * skeleton while its data fetched → the content. That is the "double loader". Now the shell's
 * Suspense fallback and the tab's cold state render the SAME shape from here, so the user sees one
 * skeleton that fills in.
 *
 * `variant` describes the body layout only; the header rail is identical everywhere, which is what
 * makes the chunk-load → data-load hand-off invisible.
 */
import { Skel } from './SalesPage';

export type SalesSkeletonVariant = 'rows' | 'grid' | 'board' | 'table' | 'form' | 'panels';

/** Header rail: eyebrow / description / actions placeholders, matching `.ss-page-head`. */
function HeadSkeleton({ metrics }: { metrics: boolean }) {
  return (
    <div className="ss-page-head">
      <div className="ss-page-head-row">
        <div className="ss-page-head-copy">
          <Skel w="112px" h="24px" radius="999px" />
          <Skel w="min(420px, 82%)" h="14px" />
        </div>
        <div className="ss-page-actions">
          <Skel w="150px" h="36px" />
        </div>
      </div>
      {metrics ? (
        <div className="ss-metrics">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="ss-metric">
              <Skel w="58px" h="11px" />
              <Skel w="44px" h="20px" style={{ marginTop: 6 }} />
              <Skel w="74px" h="10px" style={{ marginTop: 6 }} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Body-only placeholder — what a tab shows in its content slot while ITS data loads, under a header
 * that is already real. `label` names the thing being loaded for screen readers ("Loading clients").
 */
export function SalesBodySkeleton({
  variant,
  rows = 6,
  cols = 4,
  label,
}: {
  variant: SalesSkeletonVariant;
  rows?: number;
  cols?: number;
  label?: string | undefined;
}) {
  const a11y = label
    ? ({ 'aria-busy': true, 'aria-label': `Loading ${label}` } as const)
    : ({ 'aria-hidden': true } as const);

  if (variant === 'board') {
    return (
      <div className="ss-skel-board" {...a11y}>
        {Array.from({ length: cols }, (_, col) => (
          <div key={col} className="ss-skel-col">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 4px 0' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Skel w="86px" h="12px" />
                <Skel w="62px" h="10px" />
              </div>
              <Skel w="34px" h="26px" />
            </div>
            <div className="ss-skel-shell">
              {[0, 1, 2].map((card) => (
                <div key={card} className="ss-skel-card">
                  <Skel w="82%" h="13px" />
                  <Skel w="48%" h="11px" />
                  <Skel w="56%" h="11px" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'grid') {
    return (
      <div className="ss-skel-grid" {...a11y}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="ss-skel-card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Skel w="40px" h="40px" />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Skel w="72%" h="14px" />
                <Skel w="44%" h="11px" />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 6 }}>
              <Skel w="76px" h="20px" radius="99px" />
              <Skel w="62px" h="20px" radius="99px" />
            </div>
            <div
              style={{
                display: 'flex',
                gap: 16,
                marginTop: 8,
                paddingTop: 14,
                borderTop: '1px solid var(--border2)',
              }}
            >
              {[0, 1, 2].map((c) => (
                <div key={c} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Skel w="46px" h="17px" />
                  <Skel w="62px" h="11px" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'table') {
    return (
      <div
        {...a11y}
        style={{
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: 12,
            padding: '14px 18px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--alt)',
          }}
        >
          {Array.from({ length: cols }, (_, i) => (
            <Skel key={i} w="70%" h="11px" />
          ))}
        </div>
        {Array.from({ length: rows }, (_, r) => (
          <div
            key={r}
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gap: 12,
              padding: '16px 18px',
              borderBottom: '1px solid var(--border2)',
            }}
          >
            {Array.from({ length: cols }, (_, c) => (
              <Skel key={c} w={c === 0 ? '85%' : '60%'} h="12px" />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'form') {
    return (
      <div className="ss-skel-card" {...a11y} style={{ padding: 22, gap: 16 }}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Skel w="120px" h="11px" />
            <Skel w="100%" h="42px" />
          </div>
        ))}
        <Skel w="160px" h="44px" style={{ alignSelf: 'flex-end' }} />
      </div>
    );
  }

  if (variant === 'panels') {
    return (
      <div {...a11y} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="ss-metrics">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="ss-metric">
              <Skel w="58px" h="11px" />
              <Skel w="52px" h="20px" style={{ marginTop: 6 }} />
            </div>
          ))}
        </div>
        <div className="ss-skel-card" style={{ minHeight: 260 }}>
          <Skel w="180px" h="13px" />
          <Skel w="100%" h="200px" />
        </div>
      </div>
    );
  }

  return (
    <div className="ss-skel-rows" {...a11y}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ss-skel-card" style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
          <Skel w="40px" h="40px" />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Skel w="52%" h="14px" />
            <Skel w="88%" h="12px" />
          </div>
          <Skel w="70px" h="22px" radius="99px" />
        </div>
      ))}
    </div>
  );
}

/**
 * Whole-tab placeholder — the shell's Suspense fallback while a tab's chunk downloads.
 *
 * Note the missing `ss-fu`: this is the FIRST paint of the navigation, so it must not animate. The
 * tab that replaces it does carry `ss-fu`, which means the whole sequence
 * (chunk fallback → tab → data) plays exactly one entrance animation.
 */
export function SalesTabSkeleton({
  variant = 'rows',
  metrics = false,
  label,
  width = 'default',
}: {
  variant?: SalesSkeletonVariant;
  metrics?: boolean;
  label: string;
  width?: 'default' | 'narrow';
}) {
  return (
    <div
      className={`ss-page${width === 'narrow' ? ' is-narrow' : ''}`}
      aria-busy="true"
      aria-label={`Loading ${label}`}
    >
      <HeadSkeleton metrics={metrics} />
      <SalesBodySkeleton variant={variant} />
    </div>
  );
}
