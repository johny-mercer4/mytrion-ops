import { Navigate, createBrowserRouter, RouterProvider, useParams } from 'react-router-dom';
import { isMytrionId, MYTRION_URL_SLUG } from '../access/mytrions.config';
import { Landing } from './Landing';
import { MytrionGuard } from './MytrionGuard';
import { NotFound } from './NotFound';
import { WorkerLayout } from './WorkerLayout';

/** /m/:mytrion (the old canonical-id path) → /main/:slug. Unknown id still 404s. */
function LegacyMytrionRedirect() {
  const { mytrion } = useParams();
  if (!mytrion || !isMytrionId(mytrion)) return <NotFound />;
  return <Navigate to={`/main/${MYTRION_URL_SLUG[mytrion]}`} replace />;
}

/**
 * Two distinct entry points:
 *
 *   WORKER portal (behind the Zoho OAuth gate — WorkerLayout → UserContextProvider):
 *     /                  → redirect to /main (the domain root is never a page of its own)
 *     /main              → Landing: resolve access → Forbidden (0) | auto-enter (1) | picker (2+)
 *     /main/:mytrion     → MytrionGuard: validate the public slug (see mytrions.config's
 *                          MYTRION_URL_SLUG, e.g. /main/salesmytrion) + canAccess, lazy-load the module
 *     /m/:mytrion        → legacy canonical-id path (e.g. /m/sales); redirects to /main/:mytrion
 *                          so any existing bookmark/embed keeps working
 *
 *   RETIRED public client-login surface:
 *     /client      → NotFound (password sign-in is no longer a supported prod entry point)
 *
 *   *              → NotFound
 *
 * The Zoho redirect returns to the app origin ('/') with ?code&state, which WorkerLayout's provider
 * completes before the /main redirect fires — identity params are stripped after capture, so
 * /main/billingmytrion is the clean canonical URL and cross-Mytrion navigation stays client-side
 * (no re-redirect through Zoho).
 */
const router = createBrowserRouter(
  [
    {
      element: <WorkerLayout />,
      children: [
        { path: '/', element: <Navigate to="/main" replace /> },
        { path: '/main', element: <Landing /> },
        { path: '/main/:mytrion', element: <MytrionGuard /> },
        { path: '/m/:mytrion', element: <LegacyMytrionRedirect /> },
      ],
    },
    { path: '/client', element: <NotFound /> },
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
