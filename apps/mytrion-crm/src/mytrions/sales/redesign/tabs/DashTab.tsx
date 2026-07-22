/**
 * Sales Mytrion — Dashboard shell.
 * Tabs: Sales · Company · Debtors · Power BI.
 */
import { useEffect, useState } from 'react';
import { ICO, timeParts } from '../salesData';
import { s } from '../dc';
import { Icon, type IconName } from '../icons';
import { useSales } from '../ctx';
import { SalesDashPanel } from '../SalesDashPanel';
import { CompanyDashPanel } from '../CompanyDashPanel';
import { DebtorsDashPanel } from '../DebtorsDashPanel';

type DashId = 'sales' | 'company' | 'debtors' | 'powerbi';

const POWER_BI_SRC =
  'https://app.powerbi.com/reportEmbed?reportId=aeaf94da-aac2-4a23-9222-74473fc7e647&autoAuth=true&ctid=a1c5c083-78cc-45c3-9c8b-0df8705a1259';

const TAB_ICONS: Record<DashId, IconName> = {
  sales: ICO.trend,
  company: 'clients',
  debtors: ICO.money,
  powerbi: 'chart',
};

function PowerBiPanel() {
  return (
    <div className="db-powerbi-wrap">
      <iframe title="Sales_new" className="db-powerbi-frame" src={POWER_BI_SRC} allowFullScreen />
    </div>
  );
}

export function DashTab() {
  const { focusDashSub, clearFocusDashSub } = useSales();
  const [dashSub, setDashSub] = useState<DashId>(focusDashSub ?? 'sales');
  const todayDate = timeParts().dateLabel;

  useEffect(() => {
    if (!focusDashSub) return;
    setDashSub(focusDashSub);
    clearFocusDashSub();
  }, [focusDashSub, clearFocusDashSub]);

  const tabs: { id: DashId; label: string }[] = [
    { id: 'sales', label: 'Sales' },
    { id: 'company', label: 'Company' },
    { id: 'debtors', label: 'Debtors' },
    { id: 'powerbi', label: 'Power BI' },
  ];

  return (
    <div className="ss-fu" style={s('max-width:1100px')}>
      <div style={s('margin-bottom:18px')}>
        <div
          style={s(
            'font-family:Rajdhani,sans-serif;font-weight:700;font-size:22px;letter-spacing:.04em;text-transform:uppercase',
          )}
        >
          Dashboard
        </div>
        <div style={s('font-size:13px;color:var(--muted);margin-top:2px')}>{todayDate}</div>
      </div>

      <div
        role="tablist"
        aria-label="Dashboard sections"
        style={s(
          'display:flex;gap:4px;margin-bottom:20px;padding:5px;border-radius:14px;background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow-sm);overflow-x:auto',
        )}
      >
        {tabs.map((t) => {
          const on = dashSub === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setDashSub(t.id)}
              style={s(
                `display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;border:1px solid ${
                  on ? 'color-mix(in srgb,var(--accent) 45%,var(--border))' : 'transparent'
                };background:${on ? 'color-mix(in srgb,var(--accent) 12%,transparent)' : 'transparent'};color:${
                  on ? 'var(--accent)' : 'var(--muted)'
                };font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;transition:background .14s,color .14s,border-color .14s`,
              )}
            >
              <span style={s(`opacity:${on ? 1 : 0.75};display:flex`)}>
                <Icon name={TAB_ICONS[t.id]} size={15} />
              </span>
              {t.label}
            </button>
          );
        })}
      </div>

      {dashSub === 'sales' && <SalesDashPanel />}
      {dashSub === 'company' && <CompanyDashPanel />}
      {dashSub === 'debtors' && <DebtorsDashPanel />}
      {dashSub === 'powerbi' && <PowerBiPanel />}
    </div>
  );
}
