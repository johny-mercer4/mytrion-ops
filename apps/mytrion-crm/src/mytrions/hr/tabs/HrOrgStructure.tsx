import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Network, RefreshCw } from 'lucide-react';
import { getHrOrgStructure, type HrOrgNodeDto, type HrOrgStructureDto } from '../../../api/hr';
import { HrEmpty, HrPageHead } from '../HrBits';

function OrgNode({ node, depth }: { node: HrOrgNodeDto; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;

  return (
    <li className="hr-org-node">
      <div className="hr-org-row" style={{ paddingLeft: `${depth * 18}px` }}>
        {hasChildren ? (
          <button
            type="button"
            className="hr-icon-btn"
            aria-expanded={open}
            aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="hr-org-spacer" />
        )}
        <div className="hr-org-main">
          <div className="hr-org-title">
            <span className="hr-strong">{node.name}</span>
            {node.code ? <span className="hr-mono hr-org-code">{node.code}</span> : null}
          </div>
          <div className="hr-org-meta">
            {node.leadName ? <span>Lead · {node.leadName}</span> : <span>Lead · —</span>}
            <span>
              {node.activeEmployeeCount} active · {node.employeeCount} total
            </span>
          </div>
        </div>
      </div>
      {hasChildren && open ? (
        <ul className="hr-org-children">
          {node.children.map((child) => (
            <OrgNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * HR → Org Structure. Tree built only from `hr_departments` (parent_id) + `hr_employees`
 * headcounts. No Zoho live proxy and no invented nodes.
 */
export function HrOrgStructure() {
  const [data, setData] = useState<HrOrgStructureDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError('');
    void getHrOrgStructure(ac.signal)
      .then((res) => {
        if (!ac.signal.aborted) setData(res);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setData(null);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [tick]);

  return (
    <div className="hr-page">
      <HrPageHead
        tab="org"
        actions={
          <button type="button" className="hr-btn" disabled={loading} onClick={() => setTick((n) => n + 1)}>
            <RefreshCw size={14} className={loading ? 'hr-spin' : undefined} />
            Refresh
          </button>
        }
      />

      {data ? (
        <div className="hr-toolbar">
          <div className="hr-summary">
            <strong>{data.departmentCount}</strong> departments ·{' '}
            <strong>{data.employeeLinkedCount}</strong> employees linked ·{' '}
            <strong>{data.employeeUnlinkedCount}</strong> unlinked
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="hr-banner-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="hr-emp-grid" aria-busy="true">
          <div className="hr-sk" />
          <div className="hr-sk" />
        </div>
      ) : !data || data.roots.length === 0 ? (
        <HrEmpty
          icon={<Network size={26} />}
          title="No org structure yet"
          body="Departments need parent links and employees need department_id. Migrate departments first, then link employees."
        />
      ) : (
        <ul className="hr-org-tree">
          {data.roots.map((root) => (
            <OrgNode key={root.id} node={root} depth={0} />
          ))}
        </ul>
      )}
    </div>
  );
}
