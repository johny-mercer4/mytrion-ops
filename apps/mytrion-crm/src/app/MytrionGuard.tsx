import { Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { useUserContext } from '../context/UserContextProvider';
import { canAccess } from '../access/resolveAccess';
import { MYTRIONS, mytrionIdFromUrlSlug } from '../access/mytrions.config';
import { MYTRION_MODULES } from '../mytrions/registry';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { StatusMessage } from '../components/StatusMessage';
import { MytrionLoader } from '../components/MytrionLoader';
import { Forbidden } from './Forbidden';
import { NotFound } from './NotFound';

/**
 * Validates the :mytrion path param (the public URL slug, e.g. "salesmytrion" — see
 * MYTRION_URL_SLUG in mytrions.config) and gates on canAccess. A bad slug → 404; a known slug the
 * user may not enter → 403 (never a silent redirect, so a bad deep-link is legible). On pass it
 * lazy-loads the matching Mytrion module (each module renders its own <MytrionShell>).
 */
export function MytrionGuard() {
  const ctx = useUserContext();
  const { mytrion: slug } = useParams();

  const mytrion = slug ? mytrionIdFromUrlSlug(slug) : undefined;
  if (!mytrion) return <NotFound />;
  if (!canAccess(ctx, mytrion)) {
    return <Forbidden reason={`${ctx.userName} cannot access ${MYTRIONS[mytrion].title}.`} />;
  }

  const Module = MYTRION_MODULES[mytrion];
  // Boundary keyed by slug: navigating to another Mytrion resets a crashed one. Also catches
  // lazy-chunk load failures after a deploy (fallback offers Reload).
  return (
    <ErrorBoundary key={mytrion}>
      <Suspense
        fallback={
          <div data-mytrion={mytrion} style={{ display: 'contents' }}>
            <MytrionLoader appName={MYTRIONS[mytrion].title} />
          </div>
        }
      >
        <Module />
      </Suspense>
    </ErrorBoundary>
  );
}
