import { FileCheck2, Home, MessagesSquare, SlidersHorizontal, Users } from 'lucide-react';
import { ModuleShell, type ModuleTab } from '../_shared/ModuleShell';
import { TicketConsole } from '@/features/comms/TicketConsole';
import { VerificationClients } from './tabs/VerificationClients';
import './verification.css';

/**
 * Verification Mytrion — credit and compliance decisioning.
 *
 * Main / Applications / Configuration Ruleset are still STRUCTURAL ONLY — the previous module rendered
 * a full applications queue, an application modal, a configuration screen and an inbox built on ~330
 * lines of invented fixtures (`data.ts`), all deleted rather than carried forward: a fabricated credit
 * application is indistinguishable from a real one at a glance. Approving/declining or editing a
 * scoring rule is a write against someone's credit outcome, so those wait on an audited, role-gated
 * endpoint — not a queue or a form that only looks real.
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
    id: 'applications',
    label: 'Applications',
    description: 'New applications awaiting a credit and compliance decision.',
    icon: FileCheck2,
    tone: 'var(--tone-sky)',
    keywords: ['queue', 'new', 'decision', 'credit', 'approve', 'reject'],
    soon: {
      title: 'Application queue',
      body: 'Incoming applications with their documents, credit signals and decision trail. Approving or declining is a write against someone’s credit outcome, so it waits on an audited, role-gated endpoint — not a queue that only looks real.',
      sources: ['verification pipeline · verification DB'],
    },
  },
  {
    id: 'ruleset',
    label: 'Configuration Ruleset',
    description: 'The thresholds and rules that drive automatic pass, watch and stop.',
    icon: SlidersHorizontal,
    tone: 'var(--tone-amber)',
    keywords: ['rules', 'thresholds', 'tiers', 'policy', 'scoring', 'config'],
    soon: {
      title: 'Configuration ruleset',
      body: 'Score thresholds, tiers and the rules behind each automatic verdict. Editing these changes who gets credit, so it needs an audit trail and a review step before a single field becomes editable.',
      sources: ['verification pipeline · rules config'],
    },
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
    // The SHARED console — Verification's inbound queue. Visibility comes from the server's thread reader
    // filter, so there is no Verification-specific chat code.
    content: <TicketConsole mode="queue" department="verification" title="Verification tickets" />,
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
