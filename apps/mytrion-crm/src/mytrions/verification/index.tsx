import { useState } from 'react';
import { Activity, Building2, ClipboardCheck, Home, Ticket } from 'lucide-react';
import { ModuleShell, type ModuleTab } from '../_shared/ModuleShell';
import { VerificationClients } from './tabs/VerificationClients';
import { ApplicantsList } from './applicants/ApplicantsList';
import { VerificationMain } from './main/VerificationMain';
import { MytrionWatch } from './watch/MytrionWatch';
import './verification.css';
import './verificationModal.css';
import './verificationRuleset.css';

/**
 * Verification Mytrion — credit and compliance decisioning.
 *
 * New applicants is the 10-phase underwriting flow from the New Applicant Underwriting SOP, running
 * entirely on Mytrion's own Postgres (`src/modules/verificationFlow/`). A case arrives here when a
 * Sales agent completes intake; until then it is listed but locked.
 *
 * Mytrion Watch is the other half of the same job: new applicants are scored once at intake, and
 * every carrier already on the books is re-scored weekly from its own payment and fuelling
 * behaviour (`src/modules/mytrionWatch/`). Both live under Queue because they answer the same
 * question — who deserves credit — at different points in the relationship.
 *
 * The credit-platform desk (Inbox, Verification cases, Decision rules) is QUARANTINED — see
 * `legacyDesk.ts` and `src/modules/verification/killSwitches.ts`. Its components are still on disk
 * and its tests still pass; it is undeclared here so `tabRegistry.test.ts` cannot grant a permission
 * set for a tab that will not mount.
 *
 * Existing clients IS live — `src/modules/verification/verificationClients.ts` +
 * `routes/v1/verificationClients.routes.ts` read `octane.dim_company` company-wide (read-only; the
 * DWH can't be written), gated on the `verification` department.
 *
 * Main is this Mytrion's own page (`main/VerificationMain.tsx`) rather than ModuleShell's default
 * hero + launcher grid — a decisioning desk's first screen is the queue's state, not a menu. It is
 * the only module that passes `renderMain`.
 */
function tabsFor(pendingCase: string | null, clearPendingCase: () => void): ModuleTab[] {
  return [
  {
    id: 'main',
    label: 'Main',
    description: 'Decisioning throughput at a glance, and the way in to everything else.',
    icon: Home,
    tone: 'var(--tone-violet)',
    keywords: ['home', 'overview', 'queue', 'throughput'],
    // No group — Main sits above Queue / Policy / Roster without a section heading.
  },
  {
    id: 'applicants',
    label: 'New applicants',
    description: 'The 10-phase underwriting flow, from intake through to the credit decision.',
    icon: ClipboardCheck,
    tone: 'var(--tone-indigo)',
    group: 'Queue',
    hideKicker: true,
    keywords: ['queue', 'applicants', 'underwriting', 'credit', 'approve', 'decline', 'applications', 'phases'],
    // Renders its own PageHead — the queue's search, filters and refresh sit on the title's
    // baseline, which is the one thing ModuleShell's head cannot express.
    ownHead: true,
    content: <ApplicantsList initialCaseId={pendingCase} onCloseCase={clearPendingCase} />,
  },
  {
    id: 'watch',
    label: 'Mytrion Watch',
    description: 'Behavioural scoring for carriers already on the books — who is drifting, and why.',
    icon: Activity,
    tone: 'var(--tone-amber)',
    group: 'Queue',
    hideKicker: true,
    keywords: ['watch', 'score', 'scoring', 'risk', 'behaviour', 'behavior', 'monitoring', 'pd', 'default', 'credit score', 'watchlist'],
    content: <MytrionWatch />,
  },
  {
    id: 'clients',
    label: 'Existing clients',
    description: 'Every carrier company-wide, with the payment and credit terms on file.',
    icon: Building2,
    tone: 'var(--tone-emerald)',
    group: 'Roster',
    keywords: ['existing', 're-verification', 'compliance', 'review', 'renewal', 'roster', 'clients'],
    content: <VerificationClients />,
  },
  {
    id: 'tickets',
    label: 'Tickets',
    description: 'Requests filed to Verification, with the conversation attached.',
    icon: Ticket,
    tone: 'var(--tone-slate)',
    group: 'Roster',
    keywords: ['tickets', 'requests', 'chat', 'plaid', 'limit review', 'escalation', 'queue'],
    // PARKED (2026-08-03). Sales files tickets into Zoho Desk again, so this queue would read empty
    // while the real requests sit in Desk. The shared console is untouched — swap `soon` back for
    // `content: <TicketConsole mode="queue" department="verification" … />` to un-park.
    soon: {
      title: 'Verification tickets',
      body: 'Requests filed to Verification, with the conversation attached. Sales files these into Zoho Desk today, which is where they are worked — reading and replying to them in here comes back once the queue moves across.',
      sources: ['zoho desk · verification department'],
    },
  },
  ];
}

export default function VerificationMytrion() {
  /**
   * The case Main asked for, handed to New applicants when that tab mounts.
   *
   * Cleared the moment the workspace is closed, so leaving and re-entering the tab shows the queue
   * rather than silently reopening a case the agent already finished with — ModuleShell unmounts
   * inactive tabs, so a value left here WOULD be re-consumed on the next mount.
   */
  const [pendingCase, setPendingCase] = useState<string | null>(null);
  const tabs = tabsFor(pendingCase, () => setPendingCase(null));

  return (
    <ModuleShell
      id="verification"
      kicker="Decisioning"
      heroLead="Verification "
      heroAccent="Mytrion"
      heroBlurb="Credit and compliance decisioning — new applicants through the ten underwriting phases, and re-verification for clients already on the books."
      navLabel="Verification"
      tabs={tabs}
      renderMain={({ open, launchers }) => (
        <VerificationMain
          open={open}
          launchers={launchers}
          onOpenCase={(caseId) => {
            setPendingCase(caseId);
            open('applicants');
          }}
        />
      )}
    />
  );
}
