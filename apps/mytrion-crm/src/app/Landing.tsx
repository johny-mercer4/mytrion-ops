import { Navigate } from 'react-router-dom';
import { useUserContext } from '../context/UserContextProvider';
import { resolveAccessibleMytrions } from '../access/resolveAccess';
import { MYTRION_URL_SLUG } from '../access/mytrions.config';
import { Forbidden } from './Forbidden';
import { MytrionPicker } from './MytrionPicker';

/**
 * Entry resolver: 0 accessible → 403; exactly one accessible → ALWAYS auto-enter (hard rule —
 * home state can never surface the picker for a single-Mytrion user); a granted home Mytrion
 * (e.g. Sales Agent → Sales) → auto-enter; otherwise (admins / multi-access, no home) → the picker.
 */
export function Landing() {
  const ctx = useUserContext();
  const { accessible, homeMytrion } = resolveAccessibleMytrions(ctx);

  if (accessible.length === 0) {
    return <Forbidden reason={`No Mytrion is assigned to ${ctx.userName} (profile: ${ctx.profile}).`} />;
  }
  if (accessible.length === 1) {
    return <Navigate to={`/main/${MYTRION_URL_SLUG[accessible[0]!]}`} replace />;
  }
  if (homeMytrion && accessible.includes(homeMytrion)) {
    return <Navigate to={`/main/${MYTRION_URL_SLUG[homeMytrion]}`} replace />;
  }
  // Provably ids.length >= 2 here — the picker never renders for a single-Mytrion user.
  return <MytrionPicker ids={accessible} />;
}
