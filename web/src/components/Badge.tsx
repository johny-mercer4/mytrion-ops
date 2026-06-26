import type { ReactNode } from 'react';
import styles from './Badge.module.css';

interface BadgeProps {
  children: ReactNode;
  tone?: 'warn' | 'info';
}

export function Badge({ children, tone = 'warn' }: BadgeProps) {
  const toneClass = tone === 'info' ? styles.info : styles.warn;
  return <span className={`${styles.badge} ${toneClass}`}>{children}</span>;
}
