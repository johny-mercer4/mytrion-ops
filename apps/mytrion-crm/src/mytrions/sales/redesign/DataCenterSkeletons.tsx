/**
 * Data Center cold-load skeletons that are NOT covered by the shared `SalesBodySkeleton`:
 * the verification detail rail and the small related-records panels inside modals.
 *
 * The kanban / card-grid / list variants that used to live here moved into
 * `SalesTabSkeleton.tsx`, so the shell's chunk fallback and a tab's data fallback are the same
 * component (they used to be two different shapes, which is what made a cold open look like it
 * loaded twice).
 */
import { s } from './dc';

function Skel({ w, h, extra = '' }: { w: string; h: string; extra?: string }) {
  return <div className="ss-skel" style={s(`width:${w};height:${h};border-radius:var(--radius-md);${extra}`)} />;
}

/** Verification detail placeholder: same glass sections and nine-stage rhythm as the loaded page. */
export function VerificationDetailSkeleton() {
  return (
    <div
      className="ss-verification-detail-skeleton"
      aria-busy="true"
      aria-label="Loading verification detail"
    >
      <div className="ss-verification-detail-summary">
        <div style={s('display:flex;flex-direction:column;gap:8px;flex:1')}>
          <Skel w="138px" h="12px" />
          <Skel w="62%" h="15px" />
        </div>
        <Skel w="112px" h="28px" extra="border-radius:99px" />
      </div>
      <div className="ss-verification-stage-skeleton">
        {Array.from({ length: 9 }, (_, index) => (
          <div key={index} className="ss-verification-stage-skeleton-row">
            <Skel w="24px" h="24px" extra="border-radius:50%" />
            <Skel w={`${44 + (index % 3) * 8}%`} h="14px" />
            <Skel w="82px" h="22px" extra="border-radius:99px;margin-left:auto" />
          </div>
        ))}
      </div>
      <Skel w="100%" h="88px" />
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
