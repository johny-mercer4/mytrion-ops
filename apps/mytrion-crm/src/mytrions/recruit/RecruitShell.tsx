import { useState } from 'react';
import type { RecruitTabKey } from './recruitTabs';
import { BriefcaseBusiness, Home, Settings, UserRoundSearch } from 'lucide-react';
import { isAdmin } from '../../access/resolveAccess';
import { useUserContext } from '../../context/UserContextProvider';
import { MytrionShell, type NavItem, type NavSection } from '../_shared/MytrionShell';
import { RecruitCandidates } from './RecruitCandidates';
import { RecruitHome } from './RecruitHome';
import { RecruitJobs } from './RecruitJobs';
import { RecruitSettings } from './RecruitSettings';
import './recruit.css';
import './recruitPolish.css';

/** Derived — see the note in billing/Shell.tsx and access/tabRegistry.ts. */
export type RecruitView = RecruitTabKey;

export function RecruitShell() {
  const user = useUserContext();
  const admin = isAdmin(user);
  const [view, setView] = useState<RecruitView>('home');
  const open = (next: RecruitView): void => setView(next);

  const navSections: NavSection[] = [
    {
      id: 'talent',
      label: 'Talent',
      items: [
        {
          key: 'home',
          label: 'Home',
          icon: <Home size={19} />,
          tone: 'var(--tone-violet)',
          active: view === 'home',
          onClick: () => open('home'),
          primary: true,
        },
        {
          key: 'jobs',
          label: 'Job Openings',
          icon: <BriefcaseBusiness size={19} />,
          tone: 'var(--tone-sky)',
          active: view === 'jobs',
          onClick: () => open('jobs'),
          keywords: ['roles', 'vacancies', 'departments'],
          primary: true,
        },
        {
          key: 'candidates',
          label: 'Candidates',
          icon: <UserRoundSearch size={19} />,
          tone: 'var(--tone-emerald)',
          active: view === 'candidates',
          onClick: () => open('candidates'),
          keywords: ['applicants', 'employees', 'hiring'],
          primary: true,
        },
      ],
    },
  ];

  const footerNav: NavItem[] = admin
    ? [
        {
          key: 'settings',
          label: 'Settings',
          icon: <Settings size={19} />,
          tone: 'var(--tone-violet)',
          active: view === 'settings',
          onClick: () => open('settings'),
        },
      ]
    : [];

  return (
    <MytrionShell id="recruit" navSections={navSections} footerNav={footerNav} enableNavSearch>
      <div className="recruit-root">
        {view === 'home' ? <RecruitHome onOpen={open} /> : null}
        {view === 'jobs' ? <RecruitJobs /> : null}
        {view === 'candidates' ? <RecruitCandidates /> : null}
        {view === 'settings' && admin ? <RecruitSettings /> : null}
      </div>
    </MytrionShell>
  );
}
