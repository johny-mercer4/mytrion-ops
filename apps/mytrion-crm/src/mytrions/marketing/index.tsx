import { MarketingShell } from './MarketingShell';

/**
 * Marketing Mytrion — the Referral and Loyalty programs, migrated out of the Manager hub.
 *
 * Two RBAC layers, as everywhere: Layer 1 entering the Mytrion (`canAccess`), Layer 2 per tab
 * (marketingNav `access`).
 *
 * The `data-mytrion` wrapper duplicates what MytrionShell already sets on its own root — it is here
 * for portalled children (both modals re-declare `.mg-root` on their own wrapper), which would
 * otherwise escape the attribute the whole `--mg-*` token layer is scoped to.
 */
export default function MarketingMytrion() {
  return (
    <div data-mytrion="marketing" className="contents">
      <MarketingShell />
    </div>
  );
}
