import { ManagerShell } from './ManagerShell';

/**
 * Manager Mytrion — a card-hub ("wizard"): each card block opens its own page. Two RBAC layers —
 * Layer 1 entering the Mytrion (canAccess), Layer 2 per card (managerNav access). First card:
 * Referrals — the Zoho parent/child referral records browser.
 */
export default function ManagerMytrion() {
  return (
    <div data-mytrion="manager" className="contents">
      <ManagerShell />
    </div>
  );
}
