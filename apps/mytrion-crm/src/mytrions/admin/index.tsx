import { useState } from 'react';
import type { AdminTabKey } from './adminTabs';
import { AccessIcon, AlertIcon, BuildingIcon, DatabaseIcon, DocIcon, HistoryIcon, JobsIcon, KnowledgeIcon, ScopeIcon, SearchIcon, TrainIcon, UsersIcon, WarehouseIcon, Sparkle } from '../../components/icons';
import { MytrionShell, type NavSection } from '../_shared/MytrionShell';
import { AuditLog } from './AuditLog';
import { CarrierUsers } from './CarrierUsers';
import { ClientNews } from './ClientNews';
import { CmpDatabase } from './CmpDatabase';
import { Deals } from './Deals';
import { EscalationRouting } from './EscalationRouting';
import { DataLoader } from './DataLoader';
import { DwhDatabase } from './DwhDatabase';
import { VerificationDatabase } from './VerificationDatabase';
import { Jobs } from './Jobs';
import { KnowledgeBase } from './KnowledgeBase';
import { KnowledgeBrowser } from './KnowledgeBrowser';
import { KpiData } from './KpiData';
import { MytrionDatabase } from './MytrionDatabase';
import { OctaneScope } from './scope/OctaneScope';
import { AdminToastHost } from './toast';
import { Train } from './Train';
import { UserManagement } from './UserManagement';
import { ChatPanel } from '../../features/chat/ChatPanel';
import { useUserContext } from '../../context/UserContextProvider';
import shellStyles from '../_shared/MytrionShell.module.css';

/**
 * Derived from the registry — see the note in billing/Shell.tsx.
 *
 * `carrier-invites` is NOT a registry entry: it is a child row under `carriers`, and an admin
 * granting "Carrier User Management" means the screen rather than one of its two panes. It stays in
 * this union because the shell still routes to it.
 */
type Tab = AdminTabKey | 'carrier-invites';

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
          tone: 'var(--tone-sky)',
          label: 'Horizon AI',
          icon: <Sparkle />,
          active: tab === 'horizon',
          onClick: () => setTab('horizon'),
          keywords: ['chat', 'assistant'],
        },
        {
          key: 'kb',
          tone: 'var(--tone-cyan)',
          label: 'Knowledge Base',
          icon: <KnowledgeIcon />,
          active: tab === 'kb',
          onClick: () => setTab('kb'),
          keywords: ['rag', 'docs', 'sources'],
        },
        {
          key: 'train',
          tone: 'var(--tone-teal)',
          label: 'Train',
          icon: <TrainIcon />,
          active: tab === 'train',
          onClick: () => setTab('train'),
          keywords: ['ingest', 'embed'],
        },
        {
          key: 'browser',
          tone: 'var(--tone-emerald)',
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
          tone: 'var(--tone-violet)',
          label: 'User Management',
          icon: <AccessIcon />,
          active: tab === 'access',
          onClick: () => setTab('access'),
          keywords: ['rbac', 'workers', 'permissions'],
        },
        {
          key: 'carriers',
          tone: 'var(--tone-purple)',
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
          key: 'kpi-data',
          tone: 'var(--tone-cyan)',
          label: 'KPI Collection & Data',
          icon: <DatabaseIcon />,
          active: tab === 'kpi-data',
          onClick: () => setTab('kpi-data'),
          keywords: ['sales', 'metrics', 'collection', 'health', 'workers', 'facts'],
        },
        {
          key: 'data-loader',
          tone: 'var(--tone-purple)',
          label: 'Data Loader',
          icon: <DatabaseIcon />,
          active: tab === 'data-loader',
          onClick: () => setTab('data-loader'),
          keywords: ['import', 'csv', 'excel', 'nocodb', 'bulk', 'rollback'],
        },
        {
          key: 'news',
          tone: 'var(--tone-amber)',
          label: 'Client News',
          icon: <DocIcon />,
          active: tab === 'news',
          onClick: () => setTab('news'),
          keywords: ['announcements', 'inbox'],
        },
        {
          key: 'deals',
          tone: 'var(--tone-orange)',
          label: 'Deals',
          icon: <BuildingIcon />,
          active: tab === 'deals',
          onClick: () => setTab('deals'),
          keywords: ['ownership', 'transfer', 'zoho', 'recovery'],
        },
        {
          key: 'escalation-routing',
          tone: 'var(--tone-violet)',
          label: 'Escalation Routing',
          icon: <AlertIcon />,
          active: tab === 'escalation-routing',
          onClick: () => setTab('escalation-routing'),
          keywords: [
            'escalation',
            'ladder',
            'levels',
            'reason',
            'fall-to',
            'manager',
            'head of department',
            'c-level',
            'ceo',
            'coo',
            'pool',
            'routing',
            'assignee',
          ],
        },
        {
          key: 'audit',
          tone: 'var(--tone-pink)',
          label: 'Audit Log',
          icon: <HistoryIcon size={18} />,
          active: tab === 'audit',
          onClick: () => setTab('audit'),
          keywords: ['history', 'trail'],
        },
        {
          key: 'jobs',
          tone: 'var(--tone-rose)',
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
          key: 'mytrion-db',
          tone: 'var(--tone-cyan)',
          label: 'Mytrion Database',
          icon: <DatabaseIcon />,
          active: tab === 'mytrion-db',
          onClick: () => setTab('mytrion-db'),
          keywords: ['postgres', 'database', 'metadata', 'tables', 'columns', 'api names', 'types'],
        },
        {
          key: 'cmp',
          tone: 'var(--tone-indigo)',
          label: 'CMP Database',
          icon: <DatabaseIcon />,
          active: tab === 'cmp',
          onClick: () => setTab('cmp'),
          keywords: ['mysql', 'schema'],
        },
        {
          key: 'dwh',
          tone: 'var(--tone-blue)',
          label: 'Data Warehouse',
          icon: <WarehouseIcon />,
          active: tab === 'dwh',
          onClick: () => setTab('dwh'),
          keywords: ['postgres', 'dwh', 'schema'],
        },
        {
          key: 'verification-db',
          tone: 'var(--tone-blue)',
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
          tone: 'var(--tone-slate)',
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
    <MytrionShell id="admin" navSections={navSections} enableNavSearch>
      {tab === 'horizon' && (
        <div className={shellStyles.chatView}>
          <ChatPanel context={user} variant="full" showTurnInspector enableTestAs />
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
      {tab === 'escalation-routing' && <EscalationRouting />}
      {tab === 'audit' && <AuditLog />}
      {tab === 'jobs' && <Jobs />}
      {tab === 'kpi-data' && <KpiData />}
      {tab === 'data-loader' && <DataLoader />}
      {tab === 'mytrion-db' && <MytrionDatabase />}
      {tab === 'cmp' && <CmpDatabase />}
      {tab === 'dwh' && <DwhDatabase />}
      {tab === 'verification-db' && <VerificationDatabase />}
      {tab === 'scope' && <OctaneScope />}
      <AdminToastHost />
    </MytrionShell>
  );
}
