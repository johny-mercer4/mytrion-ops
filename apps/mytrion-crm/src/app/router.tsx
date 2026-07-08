import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { ClientLogin } from './ClientLogin';
import { Landing } from './Landing';
import { MytrionChatPage } from './MytrionChatPage';
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
const router = createBrowserRouter(
  [
    {
      element: <WorkerLayout />,
      children: [
        { path: '/', element: <Landing /> },
        { path: '/m/:mytrion', element: <MytrionGuard /> },
        { path: '/m/:mytrion/chat', element: <MytrionChatPage /> },
      ],
    },
    { path: '/client', element: <ClientLogin /> },
    { path: '*', element: <NotFound /> },
  ],
  {
    // Opt into the v7 behaviors now — silences the dev-console deprecation warnings and
    // makes the eventual react-router v7 upgrade a no-op for these semantics.
    future: {
      v7_relativeSplatPath: true,
      v7_fetcherPersist: true,
      v7_normalizeFormMethod: true,
      v7_partialHydration: true,
      v7_skipActionErrorRevalidation: true,
    },
  },
);

export function AppRouter() {
  // v7_startTransition wraps router state updates in React.startTransition (the v7 default).
  return <RouterProvider router={router} future={{ v7_startTransition: true }} />;
}
