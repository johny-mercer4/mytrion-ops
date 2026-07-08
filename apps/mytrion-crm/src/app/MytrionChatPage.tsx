import { useParams } from 'react-router-dom';
import { useUserContext } from '../context/UserContextProvider';
import { canAccess } from '../access/resolveAccess';
import { MYTRIONS, agentKeyFor, isMytrionId } from '../access/mytrions.config';
import { ChatPanel } from '../features/chat/ChatPanel';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { TopBar } from '../components/TopBar';
import { Forbidden } from './Forbidden';
import { NotFound } from './NotFound';

/**
 * The "pop out" destination for a Mytrion's AI Chat (`/m/:mytrion/chat`) — same gate as
 * MytrionGuard, same chat/session state (useChat persists per department+agentKey), just full-page
 * instead of the launcher's modal. Opened via the modal's "open in a new tab" button; not linked
 * from nav.
 */
export function MytrionChatPage() {
  const ctx = useUserContext();
  const { mytrion } = useParams();

  if (!mytrion || !isMytrionId(mytrion)) return <NotFound />;
  if (!canAccess(ctx, mytrion)) {
    return <Forbidden reason={`${ctx.userName} cannot access ${MYTRIONS[mytrion].title}.`} />;
  }

  const m = MYTRIONS[mytrion];
  const department = m.allDepartments ? null : m.department;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <TopBar contextBadge={m.tag} showSwitch />
      <ErrorBoundary key={mytrion}>
        <ChatPanel
          context={ctx}
          department={department}
          agentKey={agentKeyFor(mytrion)}
          standalone
        />
      </ErrorBoundary>
    </div>
  );
}
