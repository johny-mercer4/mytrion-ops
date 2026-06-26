import styles from './AppHeader.module.css';

interface AppHeaderProps {
  title: string;
  subtitle?: string;
}

export function AppHeader({ title, subtitle }: AppHeaderProps) {
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{title}</h1>
      {subtitle && <span className={styles.sub}>{subtitle}</span>}
    </header>
  );
}
