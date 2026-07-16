import './styles/index.css';

import { CsShell } from './Shell';

/** Customer Service Mytrion — live port of zoho-octane/app/mytrion-customer-service with
 * the widget's OWN design system (Paper White / Royal Blue, machine-scoped under .cs-root).
 * Panels: Home / Applications / Citifuel Clients / Analytics / Data Center + AI Chat;
 * Inbox and Service Center stay "Soon" stubs, exactly like the widget's nav. */
export default function CustomerServiceMytrion() {
  return <CsShell />;
}
