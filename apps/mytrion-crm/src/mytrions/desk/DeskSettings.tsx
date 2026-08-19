import { useEffect, useState } from 'react';
import { Building2, Gauge, ShieldCheck } from 'lucide-react';
import { getCommsCatalog, type CommsCatalog } from '@/api/comms';
import styles from './desk.module.css';

/** Highest urgency first — the order a desk lead reads an SLA table in. */
const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;

/**
 * Desk settings — the live routing/SLA picture the desk is running on. Assignment (round-robin) and
 * escalation routing are EDITED in Mytrion Admin → Escalation Routing; this is the read view so a desk
 * lead can see the current SLA targets and which departments accept work without leaving the desk.
 */
export function DeskSettings() {
  const [catalog, setCatalog] = useState<CommsCatalog | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getCommsCatalog()
      .then((c) => {
        if (!cancelled) setCatalog(c);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={styles.settings}>
      <header className={styles.settingsHead}>
        <h2 className={styles.settingsTitle}>Desk settings</h2>
        <p className={styles.settingsSub}>
          Round-robin assignment and escalation routing are configured in{' '}
          <strong>Mytrion Admin → Escalation Routing</strong>. Below is the live configuration the
          desk is currently running on.
        </p>
      </header>

      {loading ? (
        <div className={styles.skeleton} aria-busy="true" aria-label="Loading desk configuration" />
      ) : error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : catalog ? (
        <div className={styles.cards}>
          <section className={styles.card} aria-labelledby="desk-sla-h">
            <h3 className={styles.cardTitle} id="desk-sla-h">
              <Gauge size={16} aria-hidden="true" /> SLA targets
            </h3>
            <p className={styles.cardHint}>Hours from raise, by priority.</p>
            <div className={styles.tableWrap}>
              <table className={styles.slaTable}>
                <thead>
                  <tr>
                    <th scope="col">Priority</th>
                    <th scope="col">First response</th>
                    <th scope="col">Resolution</th>
                  </tr>
                </thead>
                <tbody>
                  {PRIORITIES.map((p) => (
                    <tr key={p}>
                      <td className={styles.prio} data-prio={p}>
                        {p}
                      </td>
                      <td>{catalog.sla.firstResponseHoursByPriority[p] ?? '—'}</td>
                      <td>{catalog.sla.resolutionHoursByPriority[p] ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.card} aria-labelledby="desk-dept-h">
            <h3 className={styles.cardTitle} id="desk-dept-h">
              <Building2 size={16} aria-hidden="true" /> Department routing
            </h3>
            <p className={styles.cardHint}>Which queues accept new tickets and escalations.</p>
            {catalog.departments.length === 0 ? (
              <p className={styles.cardHint}>
                No departments are configured yet — add them in Mytrion Admin.
              </p>
            ) : (
              <ul className={styles.deptList}>
                {catalog.departments.map((d) => (
                  <li key={d.department} className={styles.deptRow}>
                    <span className={styles.deptName}>{d.label || d.department}</span>
                    <span className={styles.deptFlags}>
                      <span className={styles.flag} data-on={d.acceptsTickets}>
                        <ShieldCheck size={12} aria-hidden="true" /> Tickets
                      </span>
                      <span className={styles.flag} data-on={d.acceptsEscalations}>
                        <ShieldCheck size={12} aria-hidden="true" /> Escalations
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
