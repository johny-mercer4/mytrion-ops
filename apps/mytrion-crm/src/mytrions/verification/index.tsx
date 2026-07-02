import { useState } from 'react';
import { FileText, Inbox as InboxIcon, Settings } from 'lucide-react';

import { MytrionShell, type NavItem } from '../_shared/MytrionShell';
import { Applications } from './Applications';
import { Configuration } from './Configuration';
import { Inbox } from './Inbox';
import { CLIENT_REQUESTS, NEW_APPLICATIONS, NOTIFICATIONS } from './data';

type Tab = 'applications' | 'inbox' | 'configuration';

const applicationsCount = NEW_APPLICATIONS.length + CLIENT_REQUESTS.length;
const unreadCount = NOTIFICATIONS.filter((n) => !n.read).length;

/** Verification Mytrion — carrier application review, client requests, inbox, and SOP configuration. */
export default function VerificationMytrion() {
  const [tab, setTab] = useState<Tab>('applications');

  const nav: NavItem[] = [
    {
      key: 'applications',
      label: `Applications (${applicationsCount})`,
      icon: <FileText size={19} />,
      active: tab === 'applications',
      onClick: () => setTab('applications'),
    },
    {
      key: 'inbox',
      label: `Inbox (${unreadCount})`,
      icon: <InboxIcon size={19} />,
      active: tab === 'inbox',
      onClick: () => setTab('inbox'),
    },
    {
      key: 'configuration',
      label: 'Configuration',
      icon: <Settings size={19} />,
      active: tab === 'configuration',
      onClick: () => setTab('configuration'),
    },
  ];

  return (
    <div data-mytrion="verification" className="contents">
      <MytrionShell id="verification" nav={nav}>
        {tab === 'applications' ? <Applications /> : null}
        {tab === 'inbox' ? <Inbox /> : null}
        {tab === 'configuration' ? <Configuration /> : null}
      </MytrionShell>
    </div>
  );
}
