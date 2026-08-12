/**
 * Customer Service — the panels, mounted inside the shared MytrionShell.
 *
 * This was the most divergent of the three bespoke shells: it had no header element at all, so all
 * of its chrome lived in a 238px sidebar (brand block, two collapse buttons, twelve inlined SVG
 * paths, a theme toggle, a view-as picker and a user card), plus a mobile bottom nav. It also kept
 * its own `cs.nav.collapsed` preference, separate from the app-wide one.
 *
 * `.cs-root` STAYS on a content div — a token scope, not a style scope. ~8,700 lines of
 * `.cs-root .cs-*` read custom properties declared on it. `.dark-mode` stays with it: CS declares
 * LIGHT unconditionally and treats dark as the override, i.e. inverted from the rest of the app, so
 * the class is what keeps the two in step.
 *
 * Four of twelve destinations are unbuilt, which is where the rail's `soon` pill earns its keep.
 *
 * NOT chrome, and deliberately kept: useCsRetentionRealtime fires pool toasts regardless of which
 * tab is open, so it has to live in whatever component wraps the panels; and `key={actAsKey}` on
 * the content remounts everything when View-as changes.
 */
import { useCallback, useState, type ReactNode } from 'react';
import {
  Activity,
  BarChart3,
  Building2,
  Database,
  FileText,
  FolderOpen,
  Home as HomeIcon,
  Inbox,
  MessagesSquare,
  ShieldCheck,
  Wrench,
} from 'lucide-react';

import { useImpersonation } from '../../context/ImpersonationProvider';
import { useTheme } from '../../hooks/useTheme';
import { MytrionShell, type NavItem, type NavSection } from '../_shared/MytrionShell';
import { Analytics } from './Analytics';
import { Applications } from './Applications';
import { CitiFuel } from './CitiFuel';
import { TicketConsole } from '@/features/comms/TicketConsole';
import type { CsSectionId } from './csNav';
import { Home } from './Home';
import { Maintenance } from './Maintenance';
import { CasesPanel } from './retention/CasesPanel';
import { OpenPoolReadonlyPanel } from './retention/OpenPoolReadonlyPanel';
import { CitiFolderPanel } from './retention/CitiFolderPanel';
import { useCsRetentionRealtime } from './retention/useCsRetentionRealtime';
import { Toast, type ToastState } from './Toast';

/**
 * PARKED (2026-08-03). Sales files tickets into Zoho Desk again, so this queue would read empty
 * while the real work sits in Desk. Gates the nav row and the mount together.
 */
const TICKETS_PARKED = true;

export function CsShell() {
  const { actingAs } = useImpersonation();
  const actAsKey = actingAs?.zohoUserId ?? 'self';
  const [active, setActive] = useState<CsSectionId>('home');
  const [mounted, setMounted] = useState<Partial<Record<CsSectionId, boolean>>>({ home: true });
  /* CS declares light unconditionally with dark as the override — inverted from the app default —
     so the class has to mirror the shared preference rather than being dropped. */
  const { theme } = useTheme();
  const [toast, setToast] = useState<ToastState | null>(null);

  const onPoolToast = useCallback((title: string, detail: string) => {
    setToast({ id: Date.now(), kind: 'info', message: `${title}: ${detail}` });
  }, []);

  // Fires whichever tab is open, so it belongs to the wrapper, not to a panel.
  useCsRetentionRealtime(true, onPoolToast);

  const navigate = useCallback((id: CsSectionId) => {
    setActive(id);
    setMounted((m) => (m[id] ? m : { ...m, [id]: true }));
  }, []);

  const panel = (id: CsSectionId, node: ReactNode): ReactNode =>
    mounted[id] ? (
      <div style={{ display: active === id ? 'contents' : 'none' }}>{node}</div>
    ) : null;

  const item = (id: CsSectionId, label: string, icon: ReactNode, primary = false): NavItem => ({
    key: id,
    label,
    icon,
    active: active === id,
    onClick: () => navigate(id),
    ...(primary ? { primary: true } : {}),
  });

  const soon = (key: string, label: string, icon: ReactNode): NavItem => ({
    key,
    label,
    icon,
    soon: true,
  });

  const navSections: NavSection[] = [
    {
      id: 'work',
      label: 'Work',
      items: [
        item('home', 'Home', <HomeIcon size={19} />, true),
        item('applications', 'Applications', <FileText size={19} />, true),
        item('maintenance', 'Maintenance', <Wrench size={19} />),
      ],
    },
    {
      id: 'retention',
      label: 'Retention',
      items: [
        item('retention-cases', 'Retention Cases', <ShieldCheck size={19} />, true),
        item('open-pool', 'Open Pool', <Activity size={19} />, true),
        item('citi-folder', 'CITI Folder', <FolderOpen size={19} />),
        item('citi-fuel', 'Citifuel Clients', <Building2 size={19} />),
      ],
    },
    {
      id: 'insight',
      label: 'Insight',
      items: [
        item('analytics', 'Analytics', <BarChart3 size={19} />),
        soon('data-center', 'Data Center', <Database size={19} />),
      ],
    },
    {
      id: 'comms',
      label: 'Comms',
      items: [
        soon('inbox', 'Inbox', <Inbox size={19} />),
        soon('tickets', 'Tickets', <MessagesSquare size={19} />),
        soon('service-center', 'Service Center', <Activity size={19} />),
      ],
    },
  ];

  return (
    <MytrionShell id="customer-service" navSections={navSections} enableNavSearch>
      <div className={`cs-root${theme === 'dark' ? ' dark-mode' : ''}`}>
        <main className="cs-content" key={actAsKey}>
          {panel('home', <Home onNavigate={navigate} />)}
          {panel('applications', <Applications />)}
          {panel('retention-cases', <CasesPanel />)}
          {panel('open-pool', <OpenPoolReadonlyPanel />)}
          {panel('citi-folder', <CitiFolderPanel />)}
          {panel('citi-fuel', <CitiFuel />)}
          {panel('maintenance', <Maintenance />)}
          {panel('analytics', <Analytics />)}
          {TICKETS_PARKED
            ? null
            : panel(
                'tickets',
                <TicketConsole
                  mode="queue"
                  department="customer-service"
                  title="Customer Service tickets"
                />,
              )}
        </main>
        {toast ? <Toast toast={toast} onDismiss={() => setToast(null)} /> : null}
      </div>
    </MytrionShell>
  );
}
