/**
 * Sales Mytrion — Dashboard shell.
 * Tabs: Sales · Company · Debtors · Power BI.
 */
import { useEffect, useState } from 'react';
import { ICO, timeParts, NAV_DESC } from '../salesData';
import { type IconName } from '../icons';
import { useSales } from '../ctx';
import { SalesPage, SalesPageHead, SalesSubTabs, type SalesSubTab } from '../SalesPage';
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

  const tabs: ReadonlyArray<SalesSubTab<DashId>> = [
    { id: 'sales', label: 'Sales', icon: TAB_ICONS.sales },
    { id: 'company', label: 'Company', icon: TAB_ICONS.company },
    { id: 'debtors', label: 'Debtors', icon: TAB_ICONS.debtors },
    { id: 'powerbi', label: 'Power BI', icon: TAB_ICONS.powerbi },
  ];

  return (
    <SalesPage>
      <SalesPageHead description={`${NAV_DESC.dash} · ${todayDate}`} />

      <SalesSubTabs items={tabs} value={dashSub} onChange={setDashSub} label="Dashboard section" />

      {dashSub === 'sales' && <SalesDashPanel />}
      {dashSub === 'company' && <CompanyDashPanel />}
      {dashSub === 'debtors' && <DebtorsDashPanel />}
      {dashSub === 'powerbi' && <PowerBiPanel />}
    </SalesPage>
  );
}
