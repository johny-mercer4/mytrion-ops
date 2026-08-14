import { FileCheck2, Home, Inbox, MessagesSquare, SlidersHorizontal, Users } from 'lucide-react';
import { ModuleShell, type ModuleTab } from '../_shared/ModuleShell';
import { VerificationClients } from './tabs/VerificationClients';
import { VerificationCases } from './tabs/VerificationCases';
import { VerificationInbox } from './tabs/VerificationInbox';
import { VerificationRuleset } from './tabs/VerificationRuleset';
import './verification.css';
import './verificationModal.css';
import './verificationRuleset.css';

/**
 * Verification Mytrion — credit and compliance decisioning.
 *
 * Verification cases + Inbox are live against Octane `verification_cases` and `mytrion_inbox_messages`.
 * Rules Strategies / Stop Factors edits credit-platform `stop_factors` and
 * `system_state.decision_strategies_json` through `/api/v1` (same DML as verification-mono).
 *
 * Existing clients IS live — `src/modules/verification/verificationClients.ts` +
 * `routes/v1/verificationClients.routes.ts` read `octane.dim_company` company-wide (read-only; the
 * DWH can't be written), gated on the `verification` department. Distinct from the Sales redesign's
 * own "Verification Pipeline" tab (`verificationPipeline.routes.ts`), which is the caller's own
 * deal-clients plus a mock compliance-stage snapshot — different audience, different data, on purpose.
 */
const TABS: ModuleTab[] = [
  {
    id: 'main',
    label: 'Main',
    description: 'Decisioning throughput at a glance, and the way in to everything else.',
    icon: Home,
    tone: 'var(--tone-violet)',
    keywords: ['home', 'overview', 'queue', 'throughput'],
  },
  {
    id: 'cases',
    label: 'Verification cases',
    description: 'Zoho deals ingested as shared cases, with pipeline progress from the credit platform.',
    icon: FileCheck2,
    tone: 'var(--tone-sky)',
    keywords: ['queue', 'cases', 'decision', 'credit', 'approve', 'reject', 'applications'],
    content: <VerificationCases />,
  },
  {
    id: 'inbox',
    label: 'Inbox',
    description: 'New-case and pipeline notifications for Verification.',
    icon: Inbox,
    tone: 'var(--tone-violet)',
    keywords: ['inbox', 'notifications', 'new case'],
    content: <VerificationInbox />,
  },
  {
    id: 'ruleset',
    label: 'Rules Strategies / Stop Factors',
    description: 'The stop-factor rows and decision strategies the credit-platform pipeline actually runs.',
    icon: SlidersHorizontal,
    tone: 'var(--tone-amber)',
    keywords: ['rules', 'thresholds', 'orchestration', 'stop factors', 'strategies', 'pipeline'],
    content: <VerificationRuleset />,
  },
  {
    id: 'clients',
    label: 'Existing clients',
    description: 'Every carrier company-wide, with the payment and credit terms on file.',
    icon: Users,
    tone: 'var(--tone-emerald)',
    keywords: ['existing', 're-verification', 'compliance', 'review', 'renewal', 'roster', 'clients'],
    content: <VerificationClients />,
  },
  {
    id: 'tickets',
    label: 'Tickets',
    description: 'Requests filed to Verification, with the conversation attached.',
    icon: MessagesSquare,
    tone: 'var(--tone-cyan)',
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

export default function VerificationMytrion() {
  return (
    <ModuleShell
      id="verification"
      kicker="Decisioning"
      heroLead="Verification "
      heroAccent="Mytrion"
      heroBlurb="Credit and compliance decisioning — new applications, the ruleset behind each verdict, and re-verification for clients already on the books."
      navLabel="Verification"
      tabs={TABS}
    />
  );
}
