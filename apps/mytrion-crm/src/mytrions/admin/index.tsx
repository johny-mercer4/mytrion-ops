import { useState } from 'react';
import { KnowledgeIcon, ScopeIcon, SearchIcon, TrainIcon } from '../../components/icons';
import { MytrionShell, type NavItem } from '../_shared/MytrionShell';
import { KnowledgeBase } from './KnowledgeBase';
import { KnowledgeBrowser } from './KnowledgeBrowser';
import { OctaneScope } from './OctaneScope';
import { Train } from './Train';

type Tab = 'kb' | 'train' | 'browser' | 'scope';

/** Mytrion Admin — RnD knowledge base + agent lifecycle scope, with the scoped AI chat docked right. */
export default function AdminMytrion() {
  const [tab, setTab] = useState<Tab>('kb');

  const nav: NavItem[] = [
    { key: 'kb', label: 'Knowledge Base', icon: <KnowledgeIcon />, active: tab === 'kb', onClick: () => setTab('kb') },
    { key: 'train', label: 'Train', icon: <TrainIcon />, active: tab === 'train', onClick: () => setTab('train') },
    { key: 'browser', label: 'Knowledge Browser', icon: <SearchIcon />, active: tab === 'browser', onClick: () => setTab('browser') },
    { key: 'scope', label: 'Octane-Scope', icon: <ScopeIcon />, active: tab === 'scope', onClick: () => setTab('scope') },
  ];

  return (
    <MytrionShell id="admin" nav={nav}>
      {tab === 'kb' && <KnowledgeBase />}
      {tab === 'train' && <Train />}
      {tab === 'browser' && <KnowledgeBrowser />}
      {tab === 'scope' && <OctaneScope />}
    </MytrionShell>
  );
}
