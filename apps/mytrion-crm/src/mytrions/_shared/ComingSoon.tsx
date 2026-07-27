import type { ReactNode } from 'react';
import { Clock } from 'lucide-react';
import styles from './ComingSoon.module.css';

/**
 * The one "not built yet" surface, shared by every Mytrion.
 *
 * Exists so an unbuilt tab is never filled with invented rows. Mock data in a CRM is worse than an
 * empty screen: a placeholder invoice, employee or case is indistinguishable from a real one at a
 * glance, and someone eventually quotes it. If a tab has no live source, it says so.
 *
 * `sources` lists the real tables/APIs the tab will read once it is wired — that keeps the intent
 * recorded without pretending the data already exists.
 */
export function ComingSoon({
  title,
  body,
  icon,
  sources,
  tone,
}: {
  title: string;
  body: string;
  icon?: ReactNode;
  /** Real systems this surface will read when built (e.g. 'Zoho People · Attendance'). */
  sources?: string[];
  /** Accent hue for the glyph; defaults to the module accent. */
  tone?: string;
}) {
  return (
    <div className={styles.wrap} style={tone ? ({ ['--cs-tone']: tone } as React.CSSProperties) : undefined}>
      <span className={styles.glyph}>{icon ?? <Clock size={26} />}</span>
      <div className={styles.badge}>Coming soon</div>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.body}>{body}</p>
      {sources?.length ? (
        <div className={styles.sources}>
          <span className={styles.sourcesLabel}>Will read</span>
          {sources.map((s) => (
            <span key={s} className={styles.source}>
              {s}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
