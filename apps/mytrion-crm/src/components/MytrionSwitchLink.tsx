import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Grid2x2 } from 'lucide-react';
import { useUserContext } from '../context/UserContextProvider';
import { resolveAccessibleMytrions } from '../access/resolveAccess';

/**
 * "Switch Mytrion" — a route back to the picker at /main.
 *
 * `TopBar` already offers this, but the Mytrions with bespoke chrome (Billing, Customer Service)
 * never render TopBar, so they were dead ends: once you entered, the only way to another Mytrion was
 * editing the URL or reloading. This is the same control, standalone, so those headers can drop it in
 * without adopting the whole shared bar.
 *
 * Hidden for single-Mytrion users — offering a "switch" that leads to a picker with one entry (which
 * would immediately auto-enter again) is a loop, not a feature. Nearly everyone has more than one
 * Mytrion now, so in practice it shows.
 *
 * Styling comes from the host header via `className`, because Billing's `bm-*` and CS's `cs-*` chrome
 * are visually distinct and a shared look would sit wrong in both.
 */
export function MytrionSwitchLink({
  className,
  label = 'Switch',
  style,
}: {
  className?: string;
  label?: string;
  /** Host-supplied layout, so a bespoke sidebar/header can match its own controls exactly. */
  style?: CSSProperties;
}) {
  const user = useUserContext();
  const { accessible } = resolveAccessibleMytrions(user);
  if (accessible.length <= 1) return null;
  return (
    <Link
      to="/main"
      className={className}
      title={`Switch Mytrion (${accessible.length} available)`}
      aria-label="Switch Mytrion"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', ...style }}
    >
      <Grid2x2 size={14} />
      {label}
    </Link>
  );
}
