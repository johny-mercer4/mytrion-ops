/**
 * KPI board placeholder — the real table's rhythm, on the module's single `.mg-sk` shimmer.
 * The block's own chrome (header, metric strip, search) renders at once; only the table waits.
 */
export function SalesKpiSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div
      className="mg-efs-tablewrap"
      role="status"
      aria-busy="true"
      aria-label="Loading agent KPIs"
    >
      <div className="mg-efs-sk-rows" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <span
            key={i}
            className={`mg-sk${i % 3 ? ` mg-sk-d${(i % 3) as 1 | 2}` : ''}`}
            style={{ width: '100%', height: 40, borderRadius: 'var(--mg-r-sm)' }}
          />
        ))}
      </div>
    </div>
  );
}
