import { useMemo, useState } from 'react';

import { useFinanceCtx } from '../ctx';
import { s, Svg } from '../dc';
import {
  chipStyle,
  filterTransactions,
  fmtCurrency,
  galC,
  kpiIcon,
  moneyC,
  dateTimeShort,
} from '../financeData';
import {
  ClearFiltersBtn,
  EmptyState,
  HorizontalKpi,
  ICONS,
  LoadMore,
  PageTitle,
  Panel,
  RefreshBtn,
  SearchField,
  SkelRows,
} from '../financeUi';

const TX_PRESETS = [
  ['all', 'All'],
  ['week', 'This Week'],
  ['month', 'This Month'],
  ['quarter', 'Quarter'],
] as const;

export function TransactionsTab() {
  const { openTx, refreshSync, pushToast, txLoading, startAnim } = useFinanceCtx();
  const [search, setSearch] = useState('');
  const [preset, setPreset] = useState('month');
  const [visible, setVisible] = useState(8);
  const [localLoading, setLocalLoading] = useState(false);
  const [spin, setSpin] = useState(false);

  const loading = txLoading || localLoading;

  const all = useMemo(() => filterTransactions(search, preset), [search, preset]);
  const shown = all.slice(0, visible);
  const txUnique = new Set(all.map((t) => t.txId)).size;
  const txSumAmt = all.reduce((s, t) => s + t.amount, 0);
  const txSumGal = all.reduce((s, t) => s + t.gal, 0);
  const txSumDisc = all.reduce((s, t) => s + t.disc, 0);
  const hasFilters = !!(search.trim() || preset !== 'all');

  const refresh = () => {
    setSpin(true);
    setLocalLoading(true);
    refreshSync();
    setTimeout(() => {
      setSpin(false);
      setLocalLoading(false);
      pushToast('Transactions refreshed', 'Latest line items loaded.', 'success');
      startAnim();
    }, 800);
  };

  const kpis = [
    { label: 'Line Items', kind: 'accent' as const, icon: ICONS.card, color: 'var(--text)', value: String(all.length) },
    { label: 'Funded Total', kind: 'ok' as const, icon: ICONS.dollar, color: 'var(--accent)', value: moneyC(txSumAmt) },
    { label: 'Total Fuel', kind: 'orange' as const, icon: ICONS.fuelKpi, color: 'var(--text)', value: `${galC(txSumGal)} gal` },
    { label: 'Discount Saved', kind: 'violet' as const, icon: ICONS.tag, color: 'var(--text)', value: moneyC(txSumDisc) },
  ];

  return (
    <div className="mf-fu">
      <div style={s('display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:16px')}>
        <PageTitle title="Transactions" sub={`${all.length} line items · ${txUnique} transactions${search.trim() ? ' · filtered' : ''}`} />
        <RefreshBtn onClick={refresh} spin={spin} />
      </div>

      <div style={s('display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px')}>
        {kpis.map((k) => (
          <HorizontalKpi key={k.label} icon={k.icon} iconStyle={kpiIcon(k.kind)} value={k.value} label={k.label} color={k.color} />
        ))}
      </div>

      <div style={s('display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:12px')}>
        <span style={s('font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin-right:2px')}>Period</span>
        {TX_PRESETS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="mf-chip"
            data-active={preset === id ? 'true' : 'false'}
            onClick={() => {
              setPreset(id);
              setVisible(8);
              setLocalLoading(true);
              setTimeout(() => setLocalLoading(false), 450);
              startAnim();
            }}
            style={s(chipStyle(preset === id))}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={s('display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px')}>
        <SearchField value={search} onChange={(v) => { setSearch(v); setVisible(8); }} placeholder="Search company or carrier ID…" />
        {hasFilters ? <ClearFiltersBtn onClick={() => { setSearch(''); setPreset('all'); setVisible(8); }} /> : null}
      </div>

      <Panel>
        {loading ? (
          <SkelRows n={5} h={58} />
        ) : shown.length === 0 ? (
          <EmptyState msg="No transactions match your filters." onClear={() => { setSearch(''); setPreset('all'); setVisible(8); }} />
        ) : (
          <>
            {shown.map((t) => (
              <button
                key={`${t.txId}-${t.grade}-${t.gal}`}
                type="button"
                className="mf-row"
                onClick={() => openTx(t)}
                style={s('display:flex;align-items:center;gap:13px;padding:13px 16px;border-bottom:1px solid var(--border2);cursor:pointer;width:100%;border-left:none;border-right:none;border-top:none;background:transparent;text-align:left')}
              >
                <div style={s('width:38px;height:38px;border-radius:10px;background:var(--accent-s);color:var(--accent);display:flex;align-items:center;justify-content:center;flex-shrink:0')}>
                  <Svg d={ICONS.card} size={16} />
                </div>
                <div style={s('flex:1;min-width:0')}>
                  <div style={s('font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{t.company}</div>
                  <div style={s('font-size:10.5px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
                    <span style={s("font-family:'JetBrains Mono',monospace")}>{t.txId}</span> · {t.loc} · {dateTimeShort(t.date)}
                  </div>
                </div>
                <div style={s('display:flex;align-items:center;gap:8px;flex-shrink:0')}>
                  <span style={s('font-size:9.5px;font-weight:700;padding:3px 7px;border-radius:6px;background:var(--muted-s);color:var(--text2)')}>{t.grade}</span>
                  <span style={s("font-size:9.5px;font-weight:700;padding:3px 7px;border-radius:6px;background:var(--orange-s);color:var(--orange);font-family:'JetBrains Mono',monospace")}>{galC(t.gal)} gal</span>
                  <div style={s("font-family:'JetBrains Mono',monospace;font-size:13.5px;font-weight:600;color:var(--accent);min-width:74px;text-align:right")}>{fmtCurrency(t.amount).replace('.00', '')}</div>
                </div>
              </button>
            ))}
            {all.length > visible ? (
              <LoadMore onClick={() => setVisible((v) => v + 8)} meta={`Showing ${Math.min(visible, all.length)} of ${all.length}`} />
            ) : null}
          </>
        )}
      </Panel>
    </div>
  );
}
