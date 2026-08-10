/**
 * One hero stat.
 *
 * `kind` picks a wayfinding tone in CSS; the old version took eight literal hex/rgba props from the
 * call site, which is exactly the "no raw colour in a component" rule this redesign exists to fix.
 *
 * The `last` card is a link when there is somewhere to go — that is what earns it the distinguished
 * treatment the design gives the third card, rather than it just being a differently-coloured box.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import styles from './StatCard.module.css';

export function StatCard({
  kind,
  icon,
  value,
  label,
  to,
}: {
  kind: 'access' | 'role' | 'last';
  icon: ReactNode;
  value: string;
  label: string;
  to?: string | undefined;
}) {
  const body = (
    <>
      <span className={styles.chip} aria-hidden>
        {icon}
      </span>
      <span className={styles.value}>{value}</span>
      <span className={styles.label}>{label}</span>
    </>
  );

  const className = `${styles.card} ${styles[kind]}`;
  return to ? (
    <Link className={`${className} ${styles.linked}`} to={to}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
