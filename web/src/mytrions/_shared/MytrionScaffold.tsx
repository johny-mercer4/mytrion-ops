import { MYTRIONS, type MytrionId } from '../../access/mytrions.config';
import { MytrionShell } from './MytrionShell';
import styles from './MytrionScaffold.module.css';

/**
 * Default center content for a Mytrion that doesn't yet have bespoke panels: a hero + a "panels to
 * build" checklist. The AI chat is always available in the shell's right dock. The design agent
 * replaces this with the department's real panels (see web/ARCHITECTURE.md).
 */
export function MytrionScaffold({ id, buildNotes = [] }: { id: MytrionId; buildNotes?: string[] }) {
  const m = MYTRIONS[id];

  return (
    <MytrionShell id={id}>
      <div className={styles.wrap}>
        <header>
          <div className={styles.eyebrow}>{m.title}</div>
          <h1 className={styles.title}>{m.blurb}</h1>
        </header>

        <section className={styles.panel}>
          <div className={styles.panelTitle}>
            {m.status === 'ported' ? `Port from ${m.portedFrom}` : 'New Mytrion'} — panels to build
          </div>
          {buildNotes.length > 0 && (
            <ul className={styles.notes}>
              {buildNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <p className={styles.hint}>
            The AI Chat on the right is live now. These panels come next — see web/ARCHITECTURE.md for
            the per-Mytrion porting map.
          </p>
        </section>
      </div>
    </MytrionShell>
  );
}
