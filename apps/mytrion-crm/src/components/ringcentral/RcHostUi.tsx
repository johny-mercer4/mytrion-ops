import { AlertCircle, Phone, X } from 'lucide-react';
import { revealRingCentralWidget } from './ringcentralDial';
import styles from './RcHostUi.module.css';

export interface RcToastMsg {
  id: number;
  type: 'error';
  title: string;
  message: string;
}

export interface RcHostUiProps {
  toasts: readonly RcToastMsg[];
  showSignIn: boolean;
  onSignIn: () => void;
  onDismissSignIn: () => void;
  onRemoveToast: (id: number) => void;
}

/** Sign-in prompt + error toasts for Embeddable. Layout is in CSS so mobile insets stay in one place. */
export function RcHostUi({
  toasts,
  showSignIn,
  onSignIn,
  onDismissSignIn,
  onRemoveToast,
}: RcHostUiProps) {
  if (toasts.length === 0 && !showSignIn) return null;

  return (
    <div className={`${styles.stack} rc-phone-stack`}>
      {showSignIn ? (
        <div className={`${styles.card} ${styles.cardWarn}`} role="status">
          <Phone className={styles.iconWarn} size={18} aria-hidden />
          <div className={styles.copy}>
            <div className={styles.title}>Phone not signed in</div>
            <div className={styles.body}>
              Calling, call logging and the post-call wizard stay off until you sign in.
            </div>
          </div>
          <button
            type="button"
            className={styles.signIn}
            onClick={() => {
              revealRingCentralWidget();
              onSignIn();
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            className={styles.dismiss}
            onClick={onDismissSignIn}
            aria-label="Dismiss"
          >
            <X size={15} />
          </button>
        </div>
      ) : null}
      {toasts.map((t) => (
        <div key={t.id} className={`${styles.card} ${styles.cardDanger}`} role="status">
          <AlertCircle className={styles.iconDanger} size={20} aria-hidden />
          <div className={styles.copy}>
            <div className={styles.title}>{t.title}</div>
            <div className={styles.body}>{t.message}</div>
          </div>
          <button
            type="button"
            className={styles.dismiss}
            onClick={() => onRemoveToast(t.id)}
            aria-label="Dismiss"
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
