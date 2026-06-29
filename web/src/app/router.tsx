import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Landing } from './Landing';
import { MytrionGuard } from './MytrionGuard';
import { NotFound } from './NotFound';

/**
 * Routes:
 *   /            → Landing: resolve access → Forbidden (0) | auto-enter (1) | picker (2+)
 *   /m/:mytrion  → MytrionGuard: validate slug + canAccess, then lazy-load the Mytrion module
 *   *            → NotFound
 *
 * The Zoho shim deep-links to /m/:mytrion (e.g. /m/billing); if it can't pick a slug it targets "/".
 * Identity params are stripped from the URL by UserContextProvider, so /m/billing is the clean
 * canonical in-app URL and cross-Mytrion navigation stays client-side (no re-redirect through Zoho).
 */
const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  { path: '/m/:mytrion', element: <MytrionGuard /> },
  { path: '*', element: <NotFound /> },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
