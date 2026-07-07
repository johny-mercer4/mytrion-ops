import { useState } from 'react';
import { HistoryIcon, KnowledgeIcon, ScopeIcon, SearchIcon, TrainIcon, UsersIcon } from '../../components/icons';
import { MytrionShell, type NavItem } from '../_shared/MytrionShell';
import { AuditLog } from './AuditLog';
import { CarrierUsers } from './CarrierUsers';
import { KnowledgeBase } from './KnowledgeBase';
import { KnowledgeBrowser } from './KnowledgeBrowser';
import { OctaneScope } from './scope/OctaneScope';
import { Train } from './Train';

type Tab = 'kb' | 'train' | 'browser' | 'scope' | 'carriers' | 'audit';

/** Mytrion Admin — live RnD knowledge base, carrier access, and lifecycle scope, with the scoped AI chat docked right. */
export default function AdminMytrion() {
  const [tab, setTab] = useState<Tab>('kb');
  // Bumped after a successful Train run so the Knowledge Base remounts with fresh data.
  const [kbRefreshKey, setKbRefreshKey] = useState(0);

  const nav: NavItem[] = [
    { key: 'kb', label: 'Knowledge Base', icon: <KnowledgeIcon />, active: tab === 'kb', onClick: () => setTab('kb') },
    { key: 'train', label: 'Train', icon: <TrainIcon />, active: tab === 'train', onClick: () => setTab('train') },
    { key: 'browser', label: 'Knowledge Browser', icon: <SearchIcon />, active: tab === 'browser', onClick: () => setTab('browser') },
    { key: 'carriers', label: 'Carrier User Management', icon: <UsersIcon />, active: tab === 'carriers', onClick: () => setTab('carriers') },
    { key: 'audit', label: 'Audit Log', icon: <HistoryIcon size={18} />, active: tab === 'audit', onClick: () => setTab('audit') },
    { key: 'scope', label: 'Octane-Scope', icon: <ScopeIcon />, active: tab === 'scope', onClick: () => setTab('scope') },
  ];

  return (
    <MytrionShell id="admin" nav={nav}>
      {tab === 'kb' && <KnowledgeBase key={kbRefreshKey} onAddSource={() => setTab('train')} />}
      {tab === 'train' && <Train onTrained={() => setKbRefreshKey((k) => k + 1)} />}
      {tab === 'browser' && <KnowledgeBrowser />}
      {tab === 'carriers' && <CarrierUsers />}
      {tab === 'audit' && <AuditLog />}
      {tab === 'scope' && <OctaneScope />}
    </MytrionShell>
  );
}
