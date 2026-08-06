/**
 * EFS Console placeholders. Built on `.mg-sk`, the module's single shimmer — see
 * managerWorkspace.css. Shapes match the real containers so nothing shifts on arrival, which
 * matters more here than anywhere else in Manager: these panels wait 1–11 seconds on live SOAP.
 */

function Bar({ w = '100%', h = '12px', delay = 0 }: { w?: string; h?: string; delay?: 0 | 1 | 2 }) {
  return (
    <span
      className={`mg-sk mg-sk-line${delay ? ` mg-sk-d${delay}` : ''}`}
      style={{ width: w, height: h }}
    />
  );
}

function Block({ h, delay = 0 }: { h: string; delay?: 0 | 1 | 2 }) {
  return (
    <span
      className={`mg-sk${delay ? ` mg-sk-d${delay}` : ''}`}
      style={{ width: '100%', height: h, borderRadius: 'var(--mg-r-md)' }}
    />
  );
}

/** The parent totals strip while its one `parent.snapshot` call is in flight (~1.8s). */
export function EfsParentStripSkeleton() {
  return (
    <div className="mg-efs-parent" role="status" aria-busy="true" aria-label="Loading parent account">
      {[0, 1, 2].map((i) => (
        <div key={i} aria-hidden="true">
          <Bar w="94px" h="9px" delay={(i % 3) as 0 | 1 | 2} />
          <Bar w="132px" h="22px" delay={(i % 3) as 0 | 1 | 2} />
        </div>
      ))}
    </div>
  );
}

/** The client roster. Warehouse-only, so this is brief — but the table must not jump. */
export function EfsRosterSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="mg-efs-tablewrap" role="status" aria-busy="true" aria-label="Loading clients">
      <div className="mg-efs-sk-rows" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <Block key={i} h="44px" delay={(i % 3) as 0 | 1 | 2} />
        ))}
      </div>
    </div>
  );
}

/** A dossier tab. `overview` gets figure tiles; everything else is a table. */
export function EfsPanelSkeleton({ variant }: { variant: 'overview' | 'table' }) {
  if (variant === 'overview') {
    return (
      <div className="mg-efs-overview" role="status" aria-busy="true" aria-label="Loading EFS record">
        <div className="mg-efs-figures" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <Block key={i} h="66px" delay={(i % 3) as 0 | 1 | 2} />
          ))}
        </div>
        <div className="mg-efs-sk-rows" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <Block key={i} h="38px" delay={(i % 3) as 0 | 1 | 2} />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="mg-efs-tablewrap" role="status" aria-busy="true" aria-label="Loading EFS record">
      <div className="mg-efs-sk-rows" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <Block key={i} h="38px" delay={(i % 3) as 0 | 1 | 2} />
        ))}
      </div>
    </div>
  );
}
