import { FinanceShell } from './FinanceShell';

/**
 * Finance Mytrion — Home (EFS parent balance) and Clients (receivables roster + client modal).
 *
 * Rebuilt from scratch: the previous module's dashboard/transactions/audits/segments panels were
 * mock data and were removed entirely. Everything rendered now comes from a real source — the
 * `finance.parent_snapshot` Deluge touchpoint, `octane.dim_company`, `public.cmp_invoice`, our own
 * `payment_transactions`, and `octane.mart_transaction_line_items`.
 */
export default function FinanceMytrion() {
  return (
    <div data-mytrion="finance" className="contents">
      <FinanceShell />
    </div>
  );
}
