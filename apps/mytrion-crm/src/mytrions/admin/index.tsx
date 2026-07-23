import { useState } from 'react';
import { AccessIcon, BuildingIcon, DatabaseIcon, DocIcon, HistoryIcon, JobsIcon, KnowledgeIcon, ScopeIcon, SearchIcon, TrainIcon, UsersIcon, WarehouseIcon, Sparkle } from '../../components/icons';
import { MytrionShell, type NavSection } from '../_shared/MytrionShell';
import { AuditLog } from './AuditLog';
import { CarrierUsers } from './CarrierUsers';
import { ClientNews } from './ClientNews';
import { CmpDatabase } from './CmpDatabase';
import { Deals } from './Deals';
import { DwhDatabase } from './DwhDatabase';
import { VerificationDatabase } from './VerificationDatabase';
import { Jobs } from './Jobs';
import { KnowledgeBase } from './KnowledgeBase';
import { KnowledgeBrowser } from './KnowledgeBrowser';
import { OctaneScope } from './scope/OctaneScope';
import { AdminToastHost } from './toast';
import { Train } from './Train';
import { UserManagement } from './UserManagement';
import { ChatPanel } from '../../features/chat/ChatPanel';
import { useUserContext } from '../../context/UserContextProvider';
import shellStyles from '../_shared/MytrionShell.module.css';

type Tab =
  | 'kb'
  | 'train'
  | 'browser'
  | 'scope'
  | 'carriers'
  | 'carrier-invites'
  | 'news'
  | 'deals'
  | 'audit'
  | 'jobs'
  | 'cmp'
  | 'dwh'
  | 'verification-db'
  | 'access'
  | 'horizon';

const CARRIER_TABS: Tab[] = ['carriers', 'carrier-invites'];

/** Mytrion Admin — live RnD knowledge base, carrier access, and lifecycle scope, with the scoped AI chat docked right. */
export default function AdminMytrion() {
  const [tab, setTab] = useState<Tab>('kb');
  // Bumped after a successful Train run so the Knowledge Base remounts with fresh data.
  const [kbRefreshKey, setKbRefreshKey] = useState(0);
  const user = useUserContext();

  const navSections: NavSection[] = [
    {
      id: 'ai',
      label: 'AI & Knowledge',
      items: [
        {
          key: 'horizon',
          label: 'Horizon AI',
          icon: <Sparkle />,
          active: tab === 'horizon',
          onClick: () => setTab('horizon'),
          keywords: ['chat', 'assistant'],
        },
        {
          key: 'kb',
          label: 'Knowledge Base',
          icon: <KnowledgeIcon />,
          active: tab === 'kb',
          onClick: () => setTab('kb'),
          keywords: ['rag', 'docs', 'sources'],
        },
        {
          key: 'train',
          label: 'Train',
          icon: <TrainIcon />,
          active: tab === 'train',
          onClick: () => setTab('train'),
          keywords: ['ingest', 'embed'],
        },
        {
          key: 'browser',
          label: 'Knowledge Browser',
          icon: <SearchIcon />,
          active: tab === 'browser',
          onClick: () => setTab('browser'),
          keywords: ['search', 'vector'],
        },
      ],
    },
    {
      id: 'access',
      label: 'Access',
      items: [
        {
          key: 'access',
          label: 'User Management',
          icon: <AccessIcon />,
          active: tab === 'access',
          onClick: () => setTab('access'),
          keywords: ['rbac', 'workers', 'permissions'],
        },
        {
          key: 'carriers',
          label: 'Carrier User Management',
          icon: <UsersIcon />,
          active: CARRIER_TABS.includes(tab),
          onClick: () => setTab('carriers'),
          keywords: ['companies', 'invites', 'mini-app'],
          children: [
            {
              key: 'carriers-registered',
              label: 'Registered companies',
              icon: null,
              active: tab === 'carriers',
              onClick: () => setTab('carriers'),
            },
            {
              key: 'carriers-invites',
              label: 'Invitations',
              icon: null,
              active: tab === 'carrier-invites',
              onClick: () => setTab('carrier-invites'),
            },
          ],
        },
      ],
    },
    {
      id: 'ops',
      label: 'CRM & Ops',
      items: [
        {
          key: 'news',
          label: 'Client News',
          icon: <DocIcon />,
          active: tab === 'news',
          onClick: () => setTab('news'),
          keywords: ['announcements', 'inbox'],
        },
        {
          key: 'deals',
          label: 'Deals',
          icon: <BuildingIcon />,
          active: tab === 'deals',
          onClick: () => setTab('deals'),
          keywords: ['ownership', 'transfer', 'zoho', 'recovery'],
        },
        {
          key: 'audit',
          label: 'Audit Log',
          icon: <HistoryIcon size={18} />,
          active: tab === 'audit',
          onClick: () => setTab('audit'),
          keywords: ['history', 'trail'],
        },
        {
          key: 'jobs',
          label: 'Jobs',
          icon: <JobsIcon />,
          active: tab === 'jobs',
          onClick: () => setTab('jobs'),
          keywords: ['cron', 'workers', 'queue'],
        },
      ],
    },
    {
      id: 'data',
      label: 'Data',
      items: [
        {
          key: 'cmp',
          label: 'CMP Database',
          icon: <DatabaseIcon />,
          active: tab === 'cmp',
          onClick: () => setTab('cmp'),
          keywords: ['mysql', 'schema'],
        },
        {
          key: 'dwh',
          label: 'Data Warehouse',
          icon: <WarehouseIcon />,
          active: tab === 'dwh',
          onClick: () => setTab('dwh'),
          keywords: ['postgres', 'dwh', 'schema'],
        },
        {
          key: 'verification-db',
          label: 'Verification DB',
          icon: <DatabaseIcon />,
          active: tab === 'verification-db',
          onClick: () => setTab('verification-db'),
          keywords: ['credit', 'pipeline'],
        },
      ],
    },
    {
      id: 'platform',
      label: 'Platform',
      items: [
        {
          key: 'scope',
          label: 'Octane-Scope',
          icon: <ScopeIcon />,
          active: tab === 'scope',
          onClick: () => setTab('scope'),
          keywords: ['blueprint', 'lifecycle', 'map'],
        },
      ],
    },
  ];

  return (
    <MytrionShell id="admin" navSections={navSections} enableNavSearch disableDockChat>
      {tab === 'horizon' && (
        <div className={shellStyles.chatView}>
          <ChatPanel context={user} variant="full" />
        </div>
      )}
      {tab === 'kb' && <KnowledgeBase key={kbRefreshKey} onAddSource={() => setTab('train')} />}
      {tab === 'train' && <Train onTrained={() => setKbRefreshKey((k) => k + 1)} />}
      {tab === 'browser' && <KnowledgeBrowser />}
      {tab === 'access' && <UserManagement />}
      {/* One element across both sub-tabs, so switching keeps the loaded lists and the form state. */}
      {CARRIER_TABS.includes(tab) && <CarrierUsers view={tab === 'carrier-invites' ? 'invitations' : 'registered'} />}
      {tab === 'news' && <ClientNews />}
      {tab === 'deals' && <Deals />}
      {tab === 'audit' && <AuditLog />}
      {tab === 'jobs' && <Jobs />}
      {tab === 'cmp' && <CmpDatabase />}
      {tab === 'dwh' && <DwhDatabase />}
      {tab === 'verification-db' && <VerificationDatabase />}
      {tab === 'scope' && <OctaneScope />}
      <AdminToastHost />
    </MytrionShell>
  );
}
