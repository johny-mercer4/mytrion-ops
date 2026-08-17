import type { MouseEvent, ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import styles from './PhoneList.module.css';

/**
 * Horizon phone list — title + meta, 44px tap, chevron.
 * Use below the 640 structure line. Desktop keeps its table or board.
 */
export function PhoneList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul className={styles.list} {...(label ? { 'aria-label': label } : {})}>
      {children}
    </ul>
  );
}

export function PhoneListRow({
  title,
  meta,
  onClick,
  leading,
  value,
}: {
  title: string;
  meta: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  leading?: ReactNode;
  value?: ReactNode;
}) {
  return (
    <li>
      <button type="button" className={styles.row} onClick={onClick}>
        {leading}
        <span className={styles.text}>
          <span className={styles.title}>{title}</span>
          {meta ? <span className={styles.meta}>{meta}</span> : null}
        </span>
        {value ? <span className={styles.value}>{value}</span> : null}
        <span className={styles.chevron} aria-hidden>
          <ChevronRight size={16} />
        </span>
      </button>
    </li>
  );
}
