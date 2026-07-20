import './styles/index.css';

import { BillingShell } from './Shell';

/** Billing Mytrion — live port of zoho-octane/app/billing-mytrion with the widget's OWN design
 * system (sky-blue / cyan, dark-default, machine-scoped under .bm-root). Phase 1 panels:
 * Data Center / Transactions / Debtors (live); Prepay / Returns are "Soon" stubs. */
export default function BillingMytrion() {
  return <BillingShell />;
}
