import { useUserContext } from '../../context/UserContextProvider';
import { MYTRIONS, type MytrionId } from '../../access/mytrions.config';
import { ChatPanel } from '../../features/chat/ChatPanel';
import { MytrionShell } from './MytrionShell';
import styles from './MytrionShell.module.css';

/**
 * Default skeleton body for a Mytrion: the shared AI chat scoped to this department, plus a
 * "panels to build" note (the porting/feature checklist). The design agent fleshes each Mytrion by
 * adding panels alongside (or instead of) the chat — see web/ARCHITECTURE.md for the per-Mytrion map.
 */
export function MytrionScaffold({ id, buildNotes = [] }: { id: MytrionId; buildNotes?: string[] }) {
  const user = useUserContext();
  const m = MYTRIONS[id];
  // Operational Mytrions send their single department; admin (allDepartments) sends null → broad scope.
  const department = m.allDepartments ? null : m.department;

  return (
    <MytrionShell id={id}>
      {buildNotes.length > 0 && (
        <section className={styles.notes}>
          <p className={styles.notesTitle}>
            {m.status === 'ported' ? `Port from ${m.portedFrom} — panels to build:` : 'New Mytrion — panels to build:'}
          </p>
          <ul>
            {buildNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      )}
      <ChatPanel context={user} department={department} />
    </MytrionShell>
  );
}
