import { FuelMark } from '../components/BrandMark';
import screen from './Screen.module.css';

/**
 * CLIENT sign-in — a separate, standalone page (route `/client`), deliberately OUTSIDE the worker
 * Zoho OAuth gate. Clients authenticate with a username + password (not Zoho), so this page owns
 * its own future auth flow. There is intentionally NO sign-up: client accounts are provisioned by
 * Octane, never self-registered.
 *
 * Placeholder for now — the login/password form + client session are a follow-up (Type 2). Wiring
 * it here (a dedicated page, no worker gate, no sign-up) is the architecture the owner asked for.
 */
export function ClientLogin() {
  return (
    <div className={screen.screen}>
      <div className={screen.card}>
        <FuelMark size={42} />
        <h1 className={screen.title}>Client sign in</h1>
        <p className={screen.body}>
          Client accounts sign in with a username and password. This isn’t available yet — please
          check back soon, or contact your Octane representative for access.
        </p>
      </div>
    </div>
  );
}
