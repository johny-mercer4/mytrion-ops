import { useMemo, useState } from 'react';

import { useFinanceCtx } from '../ctx';
import { Badge, s, Svg } from '../dc';
import {
  badge,
  chipStyle,
  fmtCurrency,
  initials,
  kpiIcon,
  moneyC,
} from '../financeData';
import {
  EmptyState,
  HorizontalKpi,
  ICONS,
  LoadMore,
  PageTitle,
  Panel,
  RefreshBtn,
  SkelRows,
} from '../financeUi';

export function ClientsTab() {
  const { openClient, refreshSync, pushToast, clLoading, startAnim, clientsFeed } = useFinanceCtx();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [flag, setFlag] = useState('');
  const [visible, setVisible] = useState(8);
  const [localLoading, setLocalLoading] = useState(false);
  const [spin, setSpin] = useState(false);

  const loading = clLoading || localLoading;

  const rawClients = useMemo(() => {
    return (clientsFeed || []).map((raw) => ({
      company: String(raw.company_name || raw.deal_name || '—'),
      carrier: String(raw.carrier_id || ''),
      dot: String(raw.dot_number || ''),
      city: String(raw.city || ''),
      state: String(raw.state || ''),
      terms: String(raw.payment_terms || 'Prepay') as any,
      active: raw.status === 'Active' || raw.status === 'Open',
      suspended: !!raw.suspended,
      wex: !!raw.wex,
      debt: Number(raw.total_remaining || raw.total_owed || 0),
      debtDays: Number(raw.max_debt_days || 0),
      creditLimit: Number(raw.credit_limit || 0),
    }));
  }, [clientsFeed]);

  const all = useMemo(() => {
    let list = rawClients;
    if (status === 'active') list = list.filter((c) => c.active);
    if (status === 'inactive') list = list.filter((c) => !c.active);
    if (flag === 'suspended') list = list.filter((c) => c.suspended);
    if (flag === 'debtor') list = list.filter((c) => c.debt > 0);

    const sTerm = search.toLowerCase();
    if (sTerm) {
      list = list.filter((c) => c.company.toLowerCase().includes(sTerm) || c.carrier.includes(sTerm) || c.dot.includes(sTerm));
    }
    return list;
  }, [search, status, flag, rawClients]);

  const shown = all.slice(0, visible);

  const refresh = () => {
    setSpin(true);
    setLocalLoading(true);
    refreshSync();
    setTimeout(() => {
      setSpin(false);
      setLocalLoading(false);
      pushToast('Clients refreshed', 'Latest portfolio loaded.', 'success');
      startAnim();
    }, 800);
  };

  const cActiveCount = rawClients.filter((c) => c.active).length;
  const cDebtTotal = rawClients.reduce((s, c) => s + c.debt, 0);
  const cSuspendedCount = rawClients.filter((c) => c.suspended).length;

  const kpis = [
    { label: 'Active Clients', kind: 'ok' as const, icon: ICONS.users, color: 'var(--text)', value: String(cActiveCount) },
    { label: 'Debt Total', kind: 'danger' as const, icon: ICONS.alert, color: 'var(--danger)', value: moneyC(cDebtTotal) },
    { label: 'LOC Suspended', kind: 'warn' as const, icon: ICONS.ban, color: 'var(--text)', value: String(cSuspendedCount) },
    { label: 'Fueled (30d)', kind: 'accent' as const, icon: ICONS.bolt, color: 'var(--text)', value: String(rawClients.length) },
  ];

  const clearFilters = () => {
    setSearch('');
    setStatus('all');
    setFlag('');
    setVisible(8);
  };

  return (
    <div className="mf-fu">
      <div style={s('display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:16px')}>
        <PageTitle title="Clients" sub={`${all.length} of ${rawClients.length} clients${search.trim() || status !== 'all' || flag ? ' · filtered' : ''}`} />
        <RefreshBtn onClick={refresh} spin={spin} />
      </div>

      <div style={s('display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px')}>
        {kpis.map((k) => (
          <HorizontalKpi key={k.label} icon={k.icon} iconStyle={kpiIcon(k.kind)} value={k.value} label={k.label} color={k.color} />
        ))}
      </div>

      <div style={s('display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:14px')}>
        <span style={s('font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin-right:2px')}>Status</span>
        {([['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive']] as const).map(([id, label]) => (
          <button key={id} type="button" className="mf-chip" data-active={status === id ? 'true' : 'false'} onClick={() => { setStatus(id); setVisible(8); }} style={s(chipStyle(status === id))}>
            {label}
          </button>
        ))}
        <span style={s('width:1px;height:20px;background:var(--border);margin:0 4px')} />
        <span style={s('font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin-right:2px')}>Flags</span>
        {([['suspended', 'Suspended'], ['debtor', 'Debtor']] as const).map(([id, label]) => (
          <button key={id} type="button" className="mf-chip" data-active={flag === id ? 'true' : 'false'} onClick={() => { setFlag(flag === id ? '' : id); setVisible(8); }} style={s(chipStyle(flag === id))}>
            {label}
          </button>
        ))}
        <div style={s('display:flex;align-items:center;gap:8px;margin-left:auto;min-width:200px;max-width:300px;height:36px;padding:0 12px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border)')}>
          <Svg d={ICONS.search} size={14} stroke="var(--muted)" />
          <input
            className="mf-in"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setVisible(8); }}
            placeholder="Search company or carrier…"
            style={s('flex:1;min-width:0;border:none;background:transparent;color:var(--text);font-size:13px;outline:none;padding:0')}
          />
        </div>
      </div>

      <Panel>
        {loading ? (
          <SkelRows n={5} h={60} />
        ) : shown.length === 0 ? (
          <EmptyState msg="No clients match your filters." onClear={clearFilters} />
        ) : (
          <>
            {shown.map((c) => {
              const badges = [];
              if (c.suspended) badges.push(badge('SUSPENDED', 'danger'));
              if (c.wex) badges.push(badge('WEX', 'violet'));
              badges.push(badge(c.terms, 'blue'));
              badges.push(badge(c.active ? 'Active' : 'Inactive', c.active ? 'ok' : 'muted'));
              const avBg = c.suspended ? 'var(--danger-s)' : c.active ? 'var(--accent-s)' : 'var(--muted-s)';
              const avFg = c.suspended ? 'var(--danger)' : c.active ? 'var(--accent)' : 'var(--text2)';
              const metaParts = [`#${c.carrier}`, `DOT ${c.dot}`, `${c.city}, ${c.state}`];
              if (c.debt > 0) metaParts.push(`${c.debtDays}d overdue`);
              const amount = c.debt > 0 ? moneyC(c.debt) : moneyC(c.creditLimit || 0);
              const amountColor = c.debt > 0 ? 'var(--danger)' : 'var(--muted)';
              const amountTitle = c.debt > 0 ? `Debt: ${fmtCurrency(c.debt)}` : `Credit limit: ${fmtCurrency(c.creditLimit || 0)}`;

              return (
                <button
                  key={c.carrier}
                  type="button"
                  className="mf-row"
                  onClick={() => openClient(c)}
                  style={s('display:flex;align-items:center;gap:13px;padding:13px 16px;border-bottom:1px solid var(--border2);cursor:pointer;width:100%;border-left:none;border-right:none;border-top:none;background:transparent;text-align:left')}
                >
                  <div style={s(`width:38px;height:38px;border-radius:var(--radius-md);background:${avBg};color:${avFg};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex-shrink:0`)}>
                    {initials(c.company)}
                  </div>
                  <div style={s('flex:1;min-width:0')}>
                    <div style={s('font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{c.company}</div>
                    <div style={s('font-size:10.5px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{metaParts.join(' · ')}</div>
                  </div>
                  <div style={s('display:flex;align-items:center;gap:7px;flex-shrink:0')}>
                    {badges.slice(0, 3).map((b, i) => (
                      <Badge key={i} vm={b} />
                    ))}
                    <div title={amountTitle} style={s(`font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:600;color:${amountColor};min-width:64px;text-align:right`)}>
                      {amount}
                    </div>
                  </div>
                </button>
              );
            })}
            {all.length > visible ? (
              <LoadMore onClick={() => setVisible((v) => v + 8)} meta={`Showing ${Math.min(visible, all.length)} of ${all.length}`} />
            ) : null}
          </>
        )}
      </Panel>
    </div>
  );
}
