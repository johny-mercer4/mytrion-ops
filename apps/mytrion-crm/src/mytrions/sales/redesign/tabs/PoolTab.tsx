/**
 * Open Pool tab — Sales Mytrion redesign. Claimable-deals table over DEALPOOL: header with
 * Assign-to-Me + refresh, stat pills, search, a slide-in filter drawer (assignment/status/
 * taken-by + My Deals), active-filter chips, a sortable grid with disabled already-claimed
 * rows + select-all, and an assign-confirmation modal. Ported verbatim from the reference
 * prototype's pool* handlers / renderVals() view-model (see ref/script.js).
 */
import { useRef, useState } from 'react';
import type { ChangeEvent, MouseEvent, ReactElement } from 'react';
import { s } from '../dc';
import { Icon } from '../icons';
import { badge, type BadgeVM } from '../salesData';
import { DEALPOOL } from '../mock';
import { useSales } from '../ctx';
import { useSessionUser } from '../sessionUser';

// ---------- types ----------

interface Deal {
  dealId: string;
  carrierId: string;
  company: string;
  fullName: string;
  approvalStatus: string;
  lastTransaction: string;
  inactivityReason: string;
  numberOfCards: string;
  status: string;
  comments: string;
  owner: string;
}

interface PoolFilters {
  assignmentStatus: string[];
  status: string[];
  takenBy: string[];
}

type SortKey =
  | 'carrierId'
  | 'company'
  | 'fullName'
  | 'approvalStatus'
  | 'lastTransaction'
  | 'numberOfCards'
  | 'status';

interface SortState {
  key: SortKey | null;
  dir: 'asc' | 'desc';
}

interface StatVM {
  label: string;
  value: string;
  pillStyle: string;
  dotStyle: string;
}

interface ChipVM {
  label: string;
  onClick: () => void;
}

interface FilterOptVM {
  label: string;
  checked: boolean;
  count?: string;
  dotStyle: string;
  rowStyle: string;
  onClick: () => void;
}

interface PoolRowVM {
  dealId: string;
  idx: string;
  carrierId: string;
  company: string;
  fullName: string;
  approvalHas: boolean;
  approvalBadge: BadgeVM;
  lastTx: string;
  inactivity: string;
  inactivityHas: boolean;
  cards: string;
  cardStyle: string;
  statusBadge: BadgeVM;
  owner: string;
  ownerHas: boolean;
  selected: boolean;
  cbDisabled: boolean;
  rowStyle: string;
  onClick: () => void;
  onToggle: () => void;
  onCopy: (e: MouseEvent) => void;
}

// ---------- constants / pure helpers (from renderVals) ----------

const poolStatusCol: Record<string, string> = {
  Active: 'var(--ok)',
  Inactive: 'var(--danger)',
  'Out of Reach': 'var(--muted)',
  Pending: 'var(--warn)',
  'Assigned to Agent': 'var(--violet)',
};
const poolApprovalCol: Record<string, string> = {
  Initial: 'var(--accent)',
  Requested: 'var(--accent)',
  Approved: 'var(--ok)',
  Rejected: 'var(--danger)',
  Pending: 'var(--warn)',
};
const poolApprovalLabel = (v: string): string => (v === 'Initial' ? 'Requested' : v);
const DISABLED_APPROVAL = ['Approved', 'Initial', 'Pending'];
const isPoolDisabled = (d: Deal): boolean => DISABLED_APPROVAL.includes(d.approvalStatus);
const fmtTx = (v: string): string => {
  if (!v || v === 'N/A') return '—';
  const d = new Date(v);
  return isNaN(d.getTime())
    ? v
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
const poolGrid =
  'display:grid;grid-template-columns:44px 40px 118px 1.5fr 1.15fr 1.1fr 1.05fr 1.5fr 60px 1.05fr 1.2fr;gap:10px;align-items:center';
const optRow = (active: boolean): string =>
  `display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:var(--radius-md);cursor:pointer;background:${active ? 'rgba(var(--accent-rgb),.10)' : 'transparent'}`;

const closeX = <Icon name="close" size={15} strokeWidth={2.4} />;

export function PoolTab() {
  const { pushToast } = useSales();
  const user = useSessionUser();

  const [deals, setDeals] = useState<Deal[]>(() => DEALPOOL.map((d) => ({ ...d })));
  const [poolSearch, setPoolSearchState] = useState('');
  const [poolSelected, setPoolSelected] = useState<string[]>([]);
  const [sort, setSort] = useState<SortState>({ key: null, dir: 'asc' });
  const [poolFilters, setPoolFilters] = useState<PoolFilters>({ assignmentStatus: [], status: [], takenBy: [] });
  const [poolMyDeals, setPoolMyDeals] = useState(false);
  const [poolShowFilter, setPoolShowFilter] = useState(false);
  const [poolModalOpen, setPoolModalOpen] = useState(false);
  const [poolConfirm, setPoolConfirm] = useState(false);
  const [poolSubmitting, setPoolSubmitting] = useState(false);
  const [poolSpin, setPoolSpin] = useState(false);
  const spinTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const submitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const togglePoolDeal = (id: string): void =>
    setPoolSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));
  const poolToggleAll = (): void => {
    const ids = deals.filter((d) => !isPoolDisabled(d)).map((d) => d.dealId);
    setPoolSelected((sel) => {
      const all = ids.length > 0 && ids.every((id) => sel.includes(id));
      return all ? [] : ids;
    });
  };
  const togglePoolSort = (k: SortKey): void =>
    setSort((cur) => ({ key: k, dir: cur.key === k && cur.dir === 'asc' ? 'desc' : 'asc' }));
  const togglePoolFilter = (g: keyof PoolFilters, v: string): void =>
    setPoolFilters((cur) => {
      const arr = cur[g];
      const next = arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
      return { ...cur, [g]: next };
    });
  const clearPoolFilters = (): void => {
    setPoolFilters({ assignmentStatus: [], status: [], takenBy: [] });
    setPoolMyDeals(false);
  };
  const togglePoolMyDeals = (): void => setPoolMyDeals((v) => !v);
  const copyPool = (id: string): void => pushToast('Carrier ID copied', id);
  const refreshPool = (): void => {
    setPoolSpin(true);
    clearTimeout(spinTimer.current);
    spinTimer.current = setTimeout(() => setPoolSpin(false), 900);
  };
  const openPoolAssign = (): void => {
    if (!poolSelected.length) return;
    setPoolModalOpen(true);
    setPoolConfirm(false);
  };
  const closePoolAssign = (): void => {
    if (poolSubmitting) return;
    setPoolModalOpen(false);
  };
  const submitPoolAssign = (): void => {
    if (!poolConfirm || poolSubmitting) return;
    setPoolSubmitting(true);
    const ids = poolSelected;
    const n = ids.length;
    clearTimeout(submitTimer.current);
    submitTimer.current = setTimeout(() => {
      setDeals((cur) => cur.map((d) => (ids.includes(d.dealId) ? { ...d, approvalStatus: 'Initial' } : d)));
      setPoolSubmitting(false);
      setPoolModalOpen(false);
      setPoolConfirm(false);
      setPoolSelected([]);
      pushToast('Request submitted', `${n} deal${n !== 1 ? 's' : ''} requested — pending review`);
    }, 1400);
  };

  // ---------- view-model (mirrors renderVals) ----------
  const pf = poolFilters;
  const pq = poolSearch.toLowerCase();
  let pool = deals.slice();
  if (poolMyDeals) pool = pool.filter((d) => d.owner === user.name);
  if (pf.assignmentStatus.length) pool = pool.filter((d) => pf.assignmentStatus.includes(d.approvalStatus));
  if (pf.status.length) pool = pool.filter((d) => pf.status.includes(d.status));
  if (pf.takenBy.length)
    pool = pool.filter((d) => {
      const taken = d.approvalStatus === 'Approved';
      return (pf.takenBy.includes('taken') && taken) || (pf.takenBy.includes('notTaken') && !taken);
    });
  if (pq) pool = pool.filter((d) => `${d.carrierId} ${d.company} ${d.fullName}`.toLowerCase().includes(pq));
  if (sort.key) {
    const k = sort.key;
    const dir = sort.dir === 'desc' ? -1 : 1;
    pool = pool.slice().sort((a, b) => {
      let va: string | number;
      let vb: string | number;
      if (k === 'numberOfCards') {
        va = parseInt(a[k]) || 0;
        vb = parseInt(b[k]) || 0;
      } else {
        va = String(a[k] || '').toLowerCase();
        vb = String(b[k] || '').toLowerCase();
      }
      return va < vb ? -dir : va > vb ? dir : 0;
    });
  }

  const poolSel = poolSelected;
  const selectableIds = deals.filter((d) => !isPoolDisabled(d)).map((d) => d.dealId);
  const countByApproval = (v: string): number => deals.filter((d) => d.approvalStatus === v).length;

  const poolRows: PoolRowVM[] = pool.map((d, i) => {
    const disabled = isPoolDisabled(d);
    const selected = poolSel.includes(d.dealId);
    const approved = d.approvalStatus === 'Approved';
    const aHas = !!d.approvalStatus && d.approvalStatus !== 'N/A';
    const iHas = !!d.inactivityReason && d.inactivityReason !== 'N/A';
    const oHas = approved && !!d.owner;
    return {
      dealId: d.dealId,
      idx: String(i + 1),
      carrierId: d.carrierId,
      company: d.company,
      fullName: d.fullName,
      approvalHas: aHas,
      approvalBadge: badge(poolApprovalLabel(d.approvalStatus), poolApprovalCol[d.approvalStatus] || 'var(--muted)'),
      lastTx: fmtTx(d.lastTransaction),
      inactivity: d.inactivityReason,
      inactivityHas: iHas,
      cards: d.numberOfCards,
      cardStyle: `justify-self:center;display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:26px;padding:0 8px;border-radius:var(--radius-md);font-size:11px;font-weight:700;${parseInt(d.numberOfCards) > 0 ? 'background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent)' : 'background:var(--raised);color:var(--muted)'}`,
      statusBadge: badge(d.status, poolStatusCol[d.status] || 'var(--muted)'),
      owner: d.owner,
      ownerHas: oHas,
      selected,
      cbDisabled: disabled,
      rowStyle: `${poolGrid};padding:11px 15px;border-top:1px solid var(--border2);font-size:12.5px;cursor:${disabled ? 'not-allowed' : 'pointer'};opacity:${disabled ? (approved ? 0.6 : 0.62) : 1};background:${selected ? 'rgba(var(--accent-rgb),.10)' : 'transparent'};border-left:3px solid ${selected ? 'var(--accent)' : 'transparent'};transition:background .14s`,
      onClick: () => {
        if (!disabled) togglePoolDeal(d.dealId);
      },
      onToggle: () => {
        if (!disabled) togglePoolDeal(d.dealId);
      },
      onCopy: (e: MouseEvent) => {
        e.stopPropagation();
        copyPool(d.carrierId);
      },
    };
  });

  const poolStats: StatVM[] = (
    [
      ['Total', String(deals.length), 'var(--text2)', 'var(--muted)'],
      ['Available', String(selectableIds.length), 'var(--ok)', 'var(--ok)'],
      ['Requested', String(countByApproval('Initial')), 'var(--accent)', 'var(--accent)'],
      ['Assigned', String(countByApproval('Approved')), 'var(--warn)', 'var(--warn)'],
      ['Rejected', String(countByApproval('Rejected')), 'var(--danger)', 'var(--danger)'],
    ] as const
  ).map(([label, value, col, dot]) => ({
    label,
    value,
    pillStyle: `display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:99px;background:color-mix(in srgb,${dot} 12%,transparent);font-size:11.5px;font-weight:700;color:${col}`,
    dotStyle: `width:7px;height:7px;border-radius:50%;background:${dot}`,
  }));

  const poolArrow = (k: SortKey): string => (sort.key === k ? (sort.dir === 'desc' ? '▼' : '▲') : '');

  const optAssign: FilterOptVM[] = (
    [
      ['Initial', 'Requested', 'var(--accent)'],
      ['Approved', 'Approved', 'var(--ok)'],
      ['Rejected', 'Rejected', 'var(--danger)'],
      ['Pending', 'Pending', 'var(--warn)'],
    ] as const
  ).map(([val, label, c]) => ({
    label,
    checked: pf.assignmentStatus.includes(val),
    count: String(deals.filter((d) => d.approvalStatus === val).length),
    dotStyle: `width:8px;height:8px;border-radius:50%;background:${c};flex-shrink:0`,
    onClick: () => togglePoolFilter('assignmentStatus', val),
    rowStyle: optRow(pf.assignmentStatus.includes(val)),
  }));
  const optStatus: FilterOptVM[] = (
    [
      ['Active', 'var(--ok)'],
      ['Inactive', 'var(--danger)'],
      ['Out of Reach', 'var(--muted)'],
      ['Pending', 'var(--warn)'],
      ['Assigned to Agent', 'var(--violet)'],
    ] as const
  ).map(([val, c]) => ({
    label: val,
    checked: pf.status.includes(val),
    count: String(deals.filter((d) => d.status === val).length),
    dotStyle: `width:8px;height:8px;border-radius:50%;background:${c};flex-shrink:0`,
    onClick: () => togglePoolFilter('status', val),
    rowStyle: optRow(pf.status.includes(val)),
  }));
  const optTaken: FilterOptVM[] = (
    [
      ['taken', 'Taken', 'var(--ok)'],
      ['notTaken', 'Not Taken', 'var(--muted)'],
    ] as const
  ).map(([val, label, c]) => ({
    label,
    checked: pf.takenBy.includes(val),
    dotStyle: `width:8px;height:8px;border-radius:50%;background:${c};flex-shrink:0`,
    onClick: () => togglePoolFilter('takenBy', val),
    rowStyle: optRow(pf.takenBy.includes(val)),
  }));

  const poolActiveCount = pf.assignmentStatus.length + pf.status.length + pf.takenBy.length + (poolMyDeals ? 1 : 0);
  const poolChips: ChipVM[] = [];
  if (poolMyDeals) poolChips.push({ label: 'My Deals', onClick: () => togglePoolMyDeals() });
  pf.assignmentStatus.forEach((v) => poolChips.push({ label: poolApprovalLabel(v), onClick: () => togglePoolFilter('assignmentStatus', v) }));
  pf.status.forEach((v) => poolChips.push({ label: v, onClick: () => togglePoolFilter('status', v) }));
  pf.takenBy.forEach((v) => poolChips.push({ label: v === 'taken' ? 'Taken' : 'Not Taken', onClick: () => togglePoolFilter('takenBy', v) }));

  const poolSelLabels = poolSel.slice(0, 8).map((id) => {
    const d = deals.find((x) => x.dealId === id);
    return { text: d ? d.company : id };
  });
  const poolSelMore = poolSel.length > 8 ? `+${poolSel.length - 8} more` : '';

  const poolAllChecked = selectableIds.length > 0 && selectableIds.every((id) => poolSel.includes(id));
  const poolSelCount = String(poolSel.length);
  const poolMyDealsTrack = `width:40px;height:22px;border-radius:var(--radius-md);padding:2px;border:none;cursor:pointer;transition:background .2s;display:flex;background:${poolMyDeals ? 'var(--accent)' : 'var(--border)'};justify-content:${poolMyDeals ? 'flex-end' : 'flex-start'}`;
  const poolMyDealsThumb = 'width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);display:block';
  const poolCanSubmit = poolConfirm && !poolSubmitting;
  const poolCannotSubmit = !poolConfirm && !poolSubmitting;
  const stop = (e: MouseEvent): void => e.stopPropagation();
  const dash = <span style={s('color:var(--faint)')}>—</span>;

  const filterGroups: { title: string; opts: FilterOptVM[]; showCount: boolean }[] = [
    { title: 'Assignment Status', opts: optAssign, showCount: true },
    { title: 'Status', opts: optStatus, showCount: true },
    { title: 'Taken By', opts: optTaken, showCount: false },
  ];

  const sortHead = (label: string, k: SortKey, extra?: string): ReactElement => (
    <span onClick={() => togglePoolSort(k)} style={s(`cursor:pointer${extra || ''}`)}>
      {label} {poolArrow(k)}
    </span>
  );

  // ---------- render ----------
  return (
    <>
      <div className="ss-fu" style={s('display:flex;flex-direction:column;height:calc(100vh - 150px);min-height:480px')}>
        <div style={s('display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap')}>
          <div>
            <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:22px;letter-spacing:.04em;text-transform:uppercase')}>Open Pool</div>
            <div style={s('font-size:12.5px;color:var(--muted);margin-top:2px')}>Unassigned deals available to claim. Select rows and request them to yourself.</div>
          </div>
          <div style={s('display:flex;align-items:center;gap:8px')}>
            {poolSel.length > 0 ? (
              <button onClick={openPoolAssign} className="ss-btn-p" style={s('height:38px;padding:0 16px;border-radius:var(--radius-md);border:none;background:linear-gradient(120deg,var(--accent),var(--accent-2));color:#fff;font-weight:700;font-size:12.5px;cursor:pointer;display:flex;align-items:center;gap:7px')}>
                <Icon name="assign" size={15} strokeWidth={2.2} />
                Assign to Me ({poolSelCount})
              </button>
            ) : (
              <button disabled style={s('height:38px;padding:0 16px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--muted);font-weight:700;font-size:12.5px;cursor:not-allowed;display:flex;align-items:center;gap:7px')}>
                <Icon name="assign" size={15} strokeWidth={2.2} />
                Assign to Me
              </button>
            )}
            <button onClick={refreshPool} aria-label="Refresh" className="ss-ico-btn" style={s('width:38px;height:38px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center')}>
              <Icon name="refresh" size={16} style={s(poolSpin ? 'animation:ss-spin .9s linear infinite' : '')} />
            </button>
          </div>
        </div>
        <div style={s('display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px')}>
          {poolStats.map((st) => (
            <span key={st.label} style={s(st.pillStyle)}><span style={s(st.dotStyle)}></span>{st.value} {st.label}</span>
          ))}
        </div>
        <div style={s('display:flex;gap:10px;margin-bottom:10px')}>
          <div style={s('flex:1;position:relative')}>
            <Icon name="search" size={15} style={s('position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--muted)')} />
            <input value={poolSearch} onChange={(e) => setPoolSearchState(e.target.value)} placeholder="Search company, carrier ID, or name…" className="ss-in" style={s('width:100%;height:38px;padding:0 14px 0 35px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px')} />
          </div>
          <button onClick={() => setPoolShowFilter(true)} className="ss-ico-btn" style={s('height:38px;padding:0 15px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700')}>
            <Icon name="filter" size={15} />
            Filters
            {poolActiveCount > 0 && (
              <span style={s('min-width:18px;height:18px;padding:0 5px;border-radius:99px;background:var(--accent);color:#fff;font-size:10px;font-weight:800;display:inline-flex;align-items:center;justify-content:center')}>{String(poolActiveCount)}</span>
            )}
          </button>
        </div>
        {poolChips.length > 0 && (
          <div style={s('display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:10px')}>
            <span style={s('font-size:10px;color:var(--muted);font-weight:800;letter-spacing:.06em;text-transform:uppercase')}>Active</span>
            {poolChips.map((c, i) => (
              <button key={`${c.label}-${i}`} onClick={c.onClick} style={s('display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:99px;border:1px solid rgba(var(--accent-rgb),.3);background:rgba(var(--accent-rgb),.10);color:var(--accent);font-size:11px;font-weight:700;cursor:pointer')}>{c.label}<Icon name="close" size={11} strokeWidth={3} /></button>
            ))}
            <button onClick={clearPoolFilters} style={s('background:none;border:none;color:var(--muted);font-size:11px;font-weight:700;cursor:pointer')}>Clear all</button>
          </div>
        )}
        <div style={s('flex:1;min-height:0;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);overflow:hidden;display:flex;flex-direction:column;box-shadow:var(--shadow-sm)')}>
          <div className="ss-scroll" style={s('flex:1;overflow:auto')}>
            <div style={s('min-width:1140px')}>
              <div style={s('display:grid;grid-template-columns:44px 40px 118px 1.5fr 1.15fr 1.1fr 1.05fr 1.5fr 60px 1.05fr 1.2fr;gap:10px;align-items:center;position:sticky;top:0;z-index:5;padding:11px 15px;background:var(--alt);border-bottom:1px solid var(--border);font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)')}>
                <span style={s('display:flex;align-items:center;justify-content:center')}>
                  <input type="checkbox" checked={poolAllChecked} onChange={poolToggleAll} style={s('width:15px;height:15px;cursor:pointer;accent-color:var(--accent)')} />
                </span>
                <span>#</span>
                {sortHead('Carrier ID', 'carrierId')}
                {sortHead('Company', 'company')}
                {sortHead('Full Name', 'fullName')}
                {sortHead('Assignment', 'approvalStatus')}
                {sortHead('Last Txn', 'lastTransaction')}
                <span>Inactivity Reason</span>
                {sortHead('Cards', 'numberOfCards', ';text-align:center')}
                {sortHead('Status', 'status')}
                <span>Taken By</span>
              </div>
              {poolRows.map((r) => (
                <div key={r.dealId} onClick={r.onClick} style={s(r.rowStyle)}>
                  <span style={s('display:flex;align-items:center;justify-content:center')}>
                    <input type="checkbox" checked={r.selected} disabled={r.cbDisabled} onClick={stop} onChange={r.onToggle} style={s('width:15px;height:15px;cursor:pointer;accent-color:var(--accent)')} />
                  </span>
                  <span style={s("font-family:'JetBrains Mono',monospace;color:var(--muted);font-size:11px")}>{r.idx}</span>
                  <span style={s("font-family:'JetBrains Mono',monospace;font-weight:600;font-size:12px;display:inline-flex;align-items:center;gap:5px")}>
                    {r.carrierId}
                    <button onClick={r.onCopy} aria-label="Copy carrier ID" style={s('background:none;border:none;padding:2px;cursor:pointer;color:var(--muted);display:inline-flex')}>
                      <Icon name="copy" size={12} />
                    </button>
                  </span>
                  <span style={s('font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{r.company}</span>
                  <span style={s('color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{r.fullName}</span>
                  <span>{r.approvalHas ? <span style={s(r.approvalBadge.style)}>{r.approvalBadge.text}</span> : dash}</span>
                  <span style={s('color:var(--muted);font-size:11.5px;white-space:nowrap')}>{r.lastTx}</span>
                  <span style={s('min-width:0')}>{r.inactivityHas ? <span style={s('display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text2);border-left:3px solid var(--orange);padding-left:8px')}>{r.inactivity}</span> : dash}</span>
                  <span style={s(r.cardStyle)}>{r.cards}</span>
                  <span><span style={s(r.statusBadge.style)}>{r.statusBadge.text}</span></span>
                  <span style={s('min-width:0')}>
                    {r.ownerHas ? (
                      <span style={s('display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:99px;background:color-mix(in srgb,var(--ok) 14%,transparent);color:var(--ok);font-size:11px;font-weight:700;max-width:100%;overflow:hidden')}>
                        <Icon name="user" size={12} style={s('flex-shrink:0')} />
                        <span style={s('overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{r.owner}</span>
                      </span>
                    ) : dash}
                  </span>
                </div>
              ))}
              {poolRows.length === 0 && (
                <div style={s('padding:50px 20px;text-align:center;color:var(--muted);font-size:13px')}>No deals match your filters.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {poolShowFilter && (
        <>
          <div onClick={() => setPoolShowFilter(false)} style={s('position:fixed;inset:0;z-index:130;background:rgba(3,7,14,.5);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)')}></div>
          <div style={s('position:fixed;top:0;right:0;bottom:0;z-index:131;width:330px;background:var(--surface);border-left:1px solid var(--border);box-shadow:var(--shadow);display:flex;flex-direction:column;animation:ss-slidein .25s cubic-bezier(.2,0,0,1) both')}>
            <div style={s('display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--border)')}>
              <div style={s('display:flex;align-items:center;gap:9px')}>
                <span style={s('color:var(--accent);display:flex')}>
                  <Icon name="filter" size={18} />
                </span>
                <span style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:16px;letter-spacing:.04em;text-transform:uppercase')}>Filters</span>
              </div>
              <button onClick={() => setPoolShowFilter(false)} className="ss-ico-btn" style={s('width:30px;height:30px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center')}>{closeX}</button>
            </div>
            <div className="ss-scroll" style={s('flex:1;min-height:0;padding:16px 18px;display:flex;flex-direction:column;gap:16px')}>
              <div style={s('display:flex;align-items:center;justify-content:space-between')}>
                <div>
                  <div style={s('font-size:13px;font-weight:700')}>My Deals Only</div>
                  <div style={s('font-size:11px;color:var(--muted);margin-top:2px')}>Deals assigned to you</div>
                </div>
                <button onClick={togglePoolMyDeals} style={s(poolMyDealsTrack)}><span style={s(poolMyDealsThumb)}></span></button>
              </div>
              {filterGroups.map((g) => (
                <div key={g.title}>
                  <div style={s('height:1px;background:var(--border);margin-bottom:16px')}></div>
                  <div style={s('font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin-bottom:6px')}>{g.title}</div>
                  {g.opts.map((o) => (
                    <label key={o.label} style={s(o.rowStyle)}>
                      <input type="checkbox" checked={o.checked} onChange={o.onClick} style={s('width:15px;height:15px;accent-color:var(--accent);cursor:pointer')} />
                      <span style={s(o.dotStyle)}></span>
                      <span style={s('font-size:12.5px;color:var(--text2)')}>{o.label}</span>
                      {g.showCount && <span style={s("margin-left:auto;font-size:11px;color:var(--muted);font-family:'JetBrains Mono',monospace")}>{o.count}</span>}
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <div style={s('padding:14px 18px;border-top:1px solid var(--border);display:flex;gap:10px')}>
              <button onClick={clearPoolFilters} style={s('flex:1;height:38px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--danger);font-weight:700;font-size:12.5px;cursor:pointer')}>Clear All</button>
              <button onClick={() => setPoolShowFilter(false)} className="ss-btn-p" style={s('flex:1;height:38px;border-radius:var(--radius-md);border:none;background:linear-gradient(120deg,var(--accent),var(--accent-2));color:#fff;font-weight:700;font-size:12.5px;cursor:pointer')}>Done</button>
            </div>
          </div>
        </>
      )}

      {poolModalOpen && (
        <div onClick={closePoolAssign} style={s('position:fixed;inset:0;z-index:140;background:rgba(3,7,14,.6);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px')}>
          <div onClick={stop} style={s('width:100%;max-width:460px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);border-top:3px solid var(--accent);box-shadow:var(--shadow);animation:ss-pop .22s cubic-bezier(.2,0,0,1) both;overflow:hidden')}>
            <div style={s('padding:18px 22px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:11px')}>
              <div style={s('width:38px;height:38px;border-radius:var(--radius-md);background:linear-gradient(140deg,var(--accent),var(--accent-2));color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0')}>
                <Icon name="assign" size={19} />
              </div>
              <div style={s('flex:1')}>
                <div style={s('font-size:16px;font-weight:700')}>Assign {poolSelCount} deal(s)</div>
                <div style={s('font-size:12px;color:var(--muted);margin-top:2px')}>Request selected deals to yourself</div>
              </div>
              <button onClick={closePoolAssign} className="ss-ico-btn" style={s('width:30px;height:30px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center')}>{closeX}</button>
            </div>
            <div style={s('padding:18px 22px')}>
              <div style={s('font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin-bottom:8px')}>Selected deals</div>
              <div style={s('display:flex;flex-wrap:wrap;gap:6px;max-height:110px;overflow-y:auto;margin-bottom:16px')}>
                {poolSelLabels.map((l, i) => (
                  <span key={i} style={s('padding:3px 10px;border-radius:var(--radius-md);background:rgba(var(--accent-rgb),.12);border:1px solid rgba(var(--accent-rgb),.25);color:var(--accent);font-size:11px;font-weight:600')}>{l.text}</span>
                ))}
                {poolSel.length > 8 && (
                  <span style={s('padding:3px 10px;border-radius:var(--radius-md);background:var(--raised);color:var(--muted);font-size:11px;font-weight:600')}>{poolSelMore}</span>
                )}
              </div>
              <label style={s('display:flex;align-items:flex-start;gap:11px;padding:14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);cursor:pointer')}>
                <input type="checkbox" checked={poolConfirm} onChange={(e: ChangeEvent<HTMLInputElement>) => setPoolConfirm(e.target.checked)} style={s('width:16px;height:16px;margin-top:1px;accent-color:var(--accent);cursor:pointer')} />
                <span style={s('font-size:12.5px;color:var(--text2);line-height:1.5')}>I confirm requesting <strong style={s('color:var(--accent)')}>{poolSelCount}</strong> deal(s) to myself. A stream manager will review and approve the assignment.</span>
              </label>
            </div>
            <div style={s('padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:10px')}>
              <button onClick={closePoolAssign} style={s('flex:1;height:42px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);font-weight:700;font-size:13px;cursor:pointer')}>Cancel</button>
              {poolCanSubmit && (
                <button onClick={submitPoolAssign} className="ss-btn-p" style={s('flex:1;height:42px;border-radius:var(--radius-md);border:none;background:linear-gradient(120deg,var(--accent),var(--accent-2));color:#fff;font-weight:700;font-size:13px;cursor:pointer')}>Submit Request</button>
              )}
              {poolSubmitting && (
                <button disabled style={s('flex:1;height:42px;border-radius:var(--radius-md);border:none;background:linear-gradient(120deg,var(--accent),var(--accent-2));color:#fff;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;gap:8px;opacity:.85')}>
                  <span style={s('width:15px;height:15px;border-radius:50%;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;animation:ss-spin .8s linear infinite')}></span>
                  Submitting…
                </button>
              )}
              {poolCannotSubmit && (
                <button disabled style={s('flex:1;height:42px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--muted);font-weight:700;font-size:13px;cursor:not-allowed')}>Submit Request</button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
