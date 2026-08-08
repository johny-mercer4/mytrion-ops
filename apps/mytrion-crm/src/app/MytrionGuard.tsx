import { Suspense, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useUserContext } from '../context/UserContextProvider';
import { canAccess } from '../access/resolveAccess';
import { MYTRIONS, mytrionIdFromUrlSlug } from '../access/mytrions.config';
import { MYTRION_MODULES } from '../mytrions/registry';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { MytrionLoader } from '../components/MytrionLoader';
import { Forbidden } from './Forbidden';
import { NotFound } from './NotFound';
import { rememberWorkspace } from './launcher/lastWorkspace';

/**
 * Validates the :mytrion path param (the public URL slug, e.g. "salesmytrion" — see
 * MYTRION_URL_SLUG in mytrions.config) and gates on canAccess. A bad slug → 404; a known slug the
 * user may not enter → 403 (never a silent redirect, so a bad deep-link is legible). On pass it
 * lazy-loads the matching Mytrion module (each module renders its own <MytrionShell>).
 *
 * Entry loader lives ONLY here (Suspense). Shells must not paint a second boot splash.
 */
export function MytrionGuard() {
  const ctx = useUserContext();
  const { mytrion: slug } = useParams();

  const mytrion = slug ? mytrionIdFromUrlSlug(slug) : undefined;
  const entered = mytrion && canAccess(ctx, mytrion) ? mytrion : null;

  /**
   * Record the workspace here rather than on the launcher tile's onClick, which is where it used to
   * live. That version never saw a user who auto-entered (single-workspace, or a granted home
   * Mytrion) or who switched from the header — so "Last active" actually meant "the last tile you
   * clicked on the launcher". Gated on canAccess so a 403 or a bad slug records nothing.
   */
  useEffect(() => {
    if (entered) rememberWorkspace(entered);
  }, [entered]);

  if (!mytrion) return <NotFound />;
  if (!canAccess(ctx, mytrion)) {
    return <Forbidden reason={`${ctx.userName} cannot access ${MYTRIONS[mytrion].title}.`} />;
  }

  const meta = MYTRIONS[mytrion];
  const Module = MYTRION_MODULES[mytrion];
  // Boundary keyed by slug: navigating to another Mytrion resets a crashed one. Also catches
  // lazy-chunk load failures after a deploy (fallback offers Reload).
  return (
    <ErrorBoundary key={mytrion}>
      <Suspense
        fallback={
          <div data-mytrion={mytrion} style={{ display: 'contents' }}>
            {/* No themeColor: MYTRIONS[id].hue was a FOURTH colour source per workspace, and the
                loader is the transition INTO a workspace — a purple spinner followed by a cyan HR
                is the card-promises-one-thing bug in miniature. It uses --accent like everything
                else inside the workspace boundary. */}
            <MytrionLoader text={meta.title} />
          </div>
        }
      >
        <Module />
      </Suspense>
    </ErrorBoundary>
  );
}
