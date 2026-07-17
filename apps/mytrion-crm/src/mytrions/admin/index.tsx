import { useState } from 'react';
import { AccessIcon, DatabaseIcon, HistoryIcon, KnowledgeIcon, ScopeIcon, SearchIcon, TrainIcon, UsersIcon, WarehouseIcon } from '../../components/icons';
import { MytrionShell, type NavItem } from '../_shared/MytrionShell';
import { AuditLog } from './AuditLog';
import { CarrierUsers } from './CarrierUsers';
import { CmpDatabase } from './CmpDatabase';
import { DwhDatabase } from './DwhDatabase';
import { KnowledgeBase } from './KnowledgeBase';
import { KnowledgeBrowser } from './KnowledgeBrowser';
import { OctaneScope } from './scope/OctaneScope';
import { AdminToastHost } from './toast';
import { Train } from './Train';
import { UserManagement } from './UserManagement';

type Tab = 'kb' | 'train' | 'browser' | 'scope' | 'carriers' | 'carrier-invites' | 'audit' | 'cmp' | 'dwh' | 'access';

const CARRIER_TABS: Tab[] = ['carriers', 'carrier-invites'];

/** Mytrion Admin — live RnD knowledge base, carrier access, and lifecycle scope, with the scoped AI chat docked right. */
export default function AdminMytrion() {
  const [tab, setTab] = useState<Tab>('kb');
  // Bumped after a successful Train run so the Knowledge Base remounts with fresh data.
  const [kbRefreshKey, setKbRefreshKey] = useState(0);

  const nav: NavItem[] = [
    { key: 'kb', label: 'Knowledge Base', icon: <KnowledgeIcon />, active: tab === 'kb', onClick: () => setTab('kb') },
    { key: 'train', label: 'Train', icon: <TrainIcon />, active: tab === 'train', onClick: () => setTab('train') },
    { key: 'browser', label: 'Knowledge Browser', icon: <SearchIcon />, active: tab === 'browser', onClick: () => setTab('browser') },
    { key: 'access', label: 'User Management', icon: <AccessIcon />, active: tab === 'access', onClick: () => setTab('access') },
    {
      key: 'carriers',
      label: 'Carrier User Management',
      icon: <UsersIcon />,
      active: CARRIER_TABS.includes(tab),
      onClick: () => setTab('carriers'),
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
    { key: 'audit', label: 'Audit Log', icon: <HistoryIcon size={18} />, active: tab === 'audit', onClick: () => setTab('audit') },
    { key: 'cmp', label: 'CMP Database', icon: <DatabaseIcon />, active: tab === 'cmp', onClick: () => setTab('cmp') },
    { key: 'dwh', label: 'Data Warehouse', icon: <WarehouseIcon />, active: tab === 'dwh', onClick: () => setTab('dwh') },
    { key: 'scope', label: 'Octane-Scope', icon: <ScopeIcon />, active: tab === 'scope', onClick: () => setTab('scope') },
  ];

  return (
    <MytrionShell id="admin" nav={nav}>
      {tab === 'kb' && <KnowledgeBase key={kbRefreshKey} onAddSource={() => setTab('train')} />}
      {tab === 'train' && <Train onTrained={() => setKbRefreshKey((k) => k + 1)} />}
      {tab === 'browser' && <KnowledgeBrowser />}
      {tab === 'access' && <UserManagement />}
      {/* One element across both sub-tabs, so switching keeps the loaded lists and the form state. */}
      {CARRIER_TABS.includes(tab) && <CarrierUsers view={tab === 'carrier-invites' ? 'invitations' : 'registered'} />}
      {tab === 'audit' && <AuditLog />}
      {tab === 'cmp' && <CmpDatabase />}
      {tab === 'dwh' && <DwhDatabase />}
      {tab === 'scope' && <OctaneScope />}
      <AdminToastHost />
    </MytrionShell>
  );
}
