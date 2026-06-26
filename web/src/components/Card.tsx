import type { ReactNode } from 'react';
import styles from './Card.module.css';

interface CardProps {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

/** A surface container with an optional title row. The layout primitive most views sit in. */
export function Card({ title, actions, children }: CardProps) {
  return (
    <section className={styles.card}>
      {(title || actions) && (
        <header className={styles.header}>
          {title && <h2 className={styles.title}>{title}</h2>}
          {actions && <div className={styles.actions}>{actions}</div>}
        </header>
      )}
      <div className={styles.body}>{children}</div>
    </section>
  );
}
