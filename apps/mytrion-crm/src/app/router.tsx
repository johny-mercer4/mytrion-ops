import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { ClientLogin } from './ClientLogin';
import { Landing } from './Landing';
import { MytrionGuard } from './MytrionGuard';
import { NotFound } from './NotFound';
import { WorkerLayout } from './WorkerLayout';

/**
 * Two distinct entry points:
 *
 *   WORKER portal (behind the Zoho OAuth gate — WorkerLayout → UserContextProvider):
 *     /            → Landing: resolve access → Forbidden (0) | auto-enter (1) | picker (2+)
 *     /m/:mytrion  → MytrionGuard: validate slug + canAccess, then lazy-load the Mytrion module
 *
 *   CLIENT sign-in (public, NOT worker-gated — a client is not a Zoho worker):
 *     /client      → ClientLogin (username/password; Type 2, placeholder for now)
 *
 *   *              → NotFound
 *
 * The Zoho redirect returns to the app origin ('/') with ?code&state, which WorkerLayout's provider
 * completes. Identity params are stripped after capture, so /m/billing is the clean canonical URL
 * and cross-Mytrion navigation stays client-side (no re-redirect through Zoho).
 */
const router = createBrowserRouter([
  {
    element: <WorkerLayout />,
    children: [
      { path: '/', element: <Landing /> },
      { path: '/m/:mytrion', element: <MytrionGuard /> },
    ],
  },
  { path: '/client', element: <ClientLogin /> },
  { path: '*', element: <NotFound /> },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
