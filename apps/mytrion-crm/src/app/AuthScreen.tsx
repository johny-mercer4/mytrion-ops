import type { ReactNode } from 'react';
import styles from './Screen.module.css';

type AuthPhase = 'idle' | 'redirecting' | 'exchanging';

/**
 * Shared Zoho auth shell — login gate + OAuth callback loading use the same composition so the
 * sign-in experience feels continuous (brand → status → action/error).
 */
export function AuthScreen({
  phase = 'idle',
  title,
  body,
  action,
  error,
}: {
  phase?: AuthPhase;
  title: string;
  body: string;
  action?: ReactNode;
  error?: string | undefined;
}) {
  const busy = phase === 'redirecting' || phase === 'exchanging';

  return (
    <div className={`${styles.screen} ${styles.authScreen}`}>
      <div className={`${styles.card} ${styles.authCard}`} role={busy ? 'status' : undefined} aria-busy={busy}>

        <p className={styles.authEyebrow}>Mytrion</p>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.body}>{body}</p>

        {busy && (
          <div className={styles.authProgress}>
            <span className={styles.authSpinner} aria-hidden="true" />
            <ol className={styles.authSteps}>
              <li className={phase === 'redirecting' ? styles.authStepActive : styles.authStepDone}>
                Connect to Zoho
              </li>
              <li className={phase === 'exchanging' ? styles.authStepActive : styles.authStepIdle}>
                Verify identity
              </li>
              <li className={styles.authStepIdle}>Open workspace</li>
            </ol>
          </div>
        )}

        {action}

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
