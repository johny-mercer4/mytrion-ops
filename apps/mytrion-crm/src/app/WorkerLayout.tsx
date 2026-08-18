import { Outlet } from 'react-router-dom';
import { EffectiveUserProvider, UserContextProvider } from '../context/UserContextProvider';
import { ImpersonationProvider } from '../context/ImpersonationProvider';
import { RingCentralPhone } from '../components/ringcentral/RingCentralPhone';
import { useViewportInset } from '../hooks/useViewportInset';

/**
 * Layout for the WORKER portal: everything under it runs behind the Zoho OAuth gate
 * (UserContextProvider → login gate when signed out) and inside ImpersonationProvider (admin
 * "act as agent"). Client-facing routes are siblings of this layout in the router, so they are NOT
 * wrapped by it — a client is not a Zoho worker and must not be bounced through Zoho sign-in.
 *
 * RingCentral softphone mounts here (route-gated to Sales + CS + Collection) so it survives hops
 * between those Mytrions and never appears on Billing / Finance / Admin / picker / etc.
 */
export function WorkerLayout() {
  // Publishes --kb-inset on <html>: how much of the viewport the software keyboard is covering.
  // A document-level singleton — mounted once here, never inside a component that can appear twice.
  useViewportInset();

  return (
    <UserContextProvider>
      <ImpersonationProvider>
        <EffectiveUserProvider>
          <Outlet />
          <RingCentralPhone />
        </EffectiveUserProvider>
      </ImpersonationProvider>
    </UserContextProvider>
  );
}
