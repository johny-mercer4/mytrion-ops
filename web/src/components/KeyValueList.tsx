import styles from './KeyValueList.module.css';

export interface KeyValueItem {
  label: string;
  value: string;
}

/** A definition list of label/value rows (used for the user-context details). */
export function KeyValueList({ items }: { items: KeyValueItem[] }) {
  return (
    <dl className={styles.list}>
      {items.map((item) => (
        <div className={styles.row} key={item.label}>
          <dt className={styles.key}>{item.label}</dt>
          <dd className={styles.value}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
