import { Outlet } from 'react-router-dom';
import { UserContextProvider } from '../context/UserContextProvider';
import { ImpersonationProvider } from '../context/ImpersonationProvider';
import { RingCentralPhone } from '../components/ringcentral/RingCentralPhone';

/**
 * Layout for the WORKER portal: everything under it runs behind the Zoho OAuth gate
 * (UserContextProvider → login gate when signed out) and inside ImpersonationProvider (admin
 * "act as agent"). Client-facing routes are siblings of this layout in the router, so they are NOT
 * wrapped by it — a client is not a Zoho worker and must not be bounced through Zoho sign-in.
 *
 * RingCentral softphone mounts here (route-gated to Sales + CS) so it survives hops between
 * those Mytrions and never appears on Billing / Finance / Admin / picker.
 */
export function WorkerLayout() {
  return (
    <UserContextProvider>
      <ImpersonationProvider>
        <Outlet />
        <RingCentralPhone />
      </ImpersonationProvider>
    </UserContextProvider>
  );
}
