import { Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { useUserContext } from '../context/UserContextProvider';
import { canAccess } from '../access/resolveAccess';
import { MYTRIONS, isMytrionId } from '../access/mytrions.config';
import { MYTRION_MODULES } from '../mytrions/registry';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { StatusMessage } from '../components/StatusMessage';
import { Forbidden } from './Forbidden';
import { NotFound } from './NotFound';

/**
 * Validates the :mytrion path param and gates on canAccess. A bad slug → 404; a known slug the user
 * may not enter → 403 (never a silent redirect, so a bad deep-link is legible). On pass it lazy-loads
 * the matching Mytrion module (each module renders its own <MytrionShell>).
 */
export function MytrionGuard() {
  const ctx = useUserContext();
  const { mytrion } = useParams();

  if (!mytrion || !isMytrionId(mytrion)) return <NotFound />;
  if (!canAccess(ctx, mytrion)) {
    return <Forbidden reason={`${ctx.userName} cannot access ${MYTRIONS[mytrion].title}.`} />;
  }

  const Module = MYTRION_MODULES[mytrion];
  // Boundary keyed by slug: navigating to another Mytrion resets a crashed one. Also catches
  // lazy-chunk load failures after a deploy (fallback offers Reload).
  return (
    <ErrorBoundary key={mytrion}>
      <Suspense fallback={<StatusMessage>Loading {MYTRIONS[mytrion].title}…</StatusMessage>}>
        <Module />
      </Suspense>
    </ErrorBoundary>
  );
}
