import { HomeIcon, KnowledgeIcon, ScopeIcon, TrainIcon } from '../../components/icons';
import { MytrionShell, type NavItem } from '../_shared/MytrionShell';
import { KnowledgeBase } from './KnowledgeBase';

/** Mytrion Admin (design 1c) — RnD knowledge base + agent scope, with the scoped AI chat docked right. */
export default function AdminMytrion() {
  // TODO(design agent): make these tabs switch the center panel (Train / Knowledge browser / Octane Scope).
  const nav: NavItem[] = [
    { key: 'home', label: 'Home', icon: <HomeIcon />, active: true },
    { key: 'train', label: 'Train', icon: <TrainIcon /> },
    { key: 'knowledge', label: 'Knowledge', icon: <KnowledgeIcon /> },
    { key: 'scope', label: 'Octane Scope', icon: <ScopeIcon /> },
  ];

  return (
    <MytrionShell id="admin" nav={nav}>
      <KnowledgeBase />
    </MytrionShell>
  );
}
