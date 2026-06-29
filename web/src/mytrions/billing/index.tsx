import { MytrionScaffold } from '../_shared/MytrionScaffold';

/** Billing Mytrion — invoices, transactions, debtors. Ported from billing-mytrion. */
export default function BillingMytrion() {
  return (
    <MytrionScaffold
      id="billing"
      buildNotes={[
        'Deal/transaction/debtor tables with filter + pagination (Vue computed → useMemo hooks)',
        'Currency/date formatters (bmCurrency) → shared util',
        'Split-payment UI logic',
        'Read-only role gate (BM_READONLY_ROLES) → now expressed via the access config',
        'Rewrite ZOHO.CRM.* calls → /v1 or servercrm REST',
      ]}
    />
  );
}
