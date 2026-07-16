import { Navigate } from 'react-router-dom';
import { useUserContext } from '../context/UserContextProvider';
import { resolveAccessibleMytrions } from '../access/resolveAccess';
import { Forbidden } from './Forbidden';
import { MytrionPicker } from './MytrionPicker';

/**
 * Entry resolver: 0 accessible → 403; a granted home Mytrion (e.g. Sales Agent → Sales) or a
 * single accessible one → auto-enter; otherwise (admins / multi-access, no home) → the picker.
 */
export function Landing() {
  const ctx = useUserContext();
  const { accessible, homeMytrion } = resolveAccessibleMytrions(ctx);

  if (accessible.length === 0) {
    return <Forbidden reason={`No Mytrion is assigned to ${ctx.userName} (profile: ${ctx.profile}).`} />;
  }
  // Auto-route to the configured home when it's actually accessible, else when there's just one.
  const target = homeMytrion && accessible.includes(homeMytrion) ? homeMytrion : accessible.length === 1 ? accessible[0] : null;
  if (target) {
    return <Navigate to={`/m/${target}`} replace />;
  }
  return <MytrionPicker ids={accessible} />;
}
