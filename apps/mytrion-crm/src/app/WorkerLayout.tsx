import { Outlet } from 'react-router-dom';
import { UserContextProvider } from '../context/UserContextProvider';

/**
 * Layout for the WORKER portal: everything under it runs behind the Zoho OAuth gate
 * (UserContextProvider → login gate when signed out). Client-facing routes are siblings of this
 * layout in the router, so they are NOT wrapped by it — a client is not a Zoho worker and must not
 * be bounced through Zoho sign-in. See [[zoho-oauth-auth]].
 */
export function WorkerLayout() {
  return (
    <UserContextProvider>
      <Outlet />
    </UserContextProvider>
  );
}
