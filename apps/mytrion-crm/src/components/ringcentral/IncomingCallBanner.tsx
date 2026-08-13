import { useEffect, useState } from 'react';
import { PhoneIncoming } from 'lucide-react';
import { useIsPhone } from '../../hooks/useMediaQuery';
import { revealRingCentralWidget } from './ringcentralDial';
import { subscribeRingCentral } from './ringcentralEvents';
import styles from './IncomingCallBanner.module.css';

const RINGING_ATTR = 'rcRinging';

function setRingingFlag(on: boolean): void {
  if (on) document.documentElement.dataset[RINGING_ATTR] = 'true';
  else delete document.documentElement.dataset[RINGING_ATTR];
}

/**
 * Phone-only incoming-call chrome. The vendor pill docks on the tab bar; this banner sits above
 * `--layout-bottom-inset` and opens the widget so the agent can answer.
 */
export function IncomingCallBanner() {
  const phone = useIsPhone();
  const [peer, setPeer] = useState<string | null>(null);

  useEffect(() => {
    return subscribeRingCentral((event) => {
      if (event.kind === 'ringing' && event.direction !== 'Outbound') {
        setPeer(event.peer || 'Unknown number');
        setRingingFlag(true);
        return;
      }
      if (event.kind === 'connected' || event.kind === 'ended' || event.kind === 'logout') {
        setPeer(null);
        setRingingFlag(false);
      }
    });
  }, []);

  useEffect(() => () => setRingingFlag(false), []);

  if (!phone || !peer) return null;

  return (
    <div className={`${styles.banner} rc-phone-stack`} role="status">
      <PhoneIncoming className={styles.icon} size={20} aria-hidden />
      <div className={styles.copy}>
        <span className={styles.title}>Incoming call</span>
        <span className={styles.peer}>{peer}</span>
      </div>
      <button
        type="button"
        className={styles.open}
        onClick={() => revealRingCentralWidget()}
      >
        Open phone
      </button>
    </div>
  );
}
