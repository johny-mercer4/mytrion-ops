import { Navigate } from 'react-router-dom';
import { useUserContext } from '../context/UserContextProvider';
import { resolveAccessibleMytrions } from '../access/resolveAccess';
import { Forbidden } from './Forbidden';
import { MytrionPicker } from './MytrionPicker';

/** Entry resolver: 0 accessible → 403; exactly 1 → auto-enter; 2+ → picker. */
export function Landing() {
  const ctx = useUserContext();
  const { accessible } = resolveAccessibleMytrions(ctx);

  if (accessible.length === 0) {
    return <Forbidden reason={`No Mytrion is assigned to ${ctx.userName} (profile: ${ctx.profile}).`} />;
  }
  if (accessible.length === 1) {
    return <Navigate to={`/m/${accessible[0]}`} replace />;
  }
  return <MytrionPicker ids={accessible} />;
}
