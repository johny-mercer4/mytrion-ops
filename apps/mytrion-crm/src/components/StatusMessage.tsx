import type { ReactNode } from 'react';
import styles from './StatusMessage.module.css';

interface StatusMessageProps {
  children: ReactNode;
  tone?: 'info' | 'error';
}

export function StatusMessage({ children, tone = 'info' }: StatusMessageProps) {
  const toneClass = tone === 'error' ? styles.error : styles.info;
  return <p className={`${styles.status} ${toneClass}`}>{children}</p>;
}
