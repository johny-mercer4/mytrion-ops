import { PhoneOff } from 'lucide-react';
import styles from './TelegramCallingNotice.module.css';

/** Shown instead of Embeddable inside Telegram — WebRTC and OAuth popups do not work there. */
export function TelegramCallingNotice() {
  return (
    <div className={`${styles.card} rc-phone-stack`} role="status">
      <PhoneOff className={styles.icon} size={18} aria-hidden />
      <div className={styles.copy}>
        <span className={styles.title}>Calling isn’t available in Telegram</span>
        <p className={styles.body}>
          Use Mytrion on a desktop browser or the RingCentral app to place and answer calls.
        </p>
      </div>
    </div>
  );
}
