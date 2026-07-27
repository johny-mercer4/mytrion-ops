import { FileCheck2, Home, SlidersHorizontal, Users } from 'lucide-react';
import { ModuleShell, type ModuleTab } from '../_shared/ModuleShell';

/**
 * Verification Mytrion — credit and compliance decisioning.
 *
 * STRUCTURAL ONLY. The previous module rendered a full applications queue, an application modal, a
 * configuration screen and an inbox built on ~330 lines of invented fixtures (`data.ts`) — 7 fake
 * applications, 5 client requests, 8 notifications. All of it was deleted rather than carried
 * forward: a fabricated credit application is indistinguishable from a real one at a glance.
 *
 * There IS a real backend to wire to — `src/modules/verificationPipeline/service.ts` and
 * `routes/v1/verificationPipeline.routes.ts` already read the verification DB — so these tabs name
 * it as their source instead of guessing.
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
    description: 'Re-verification and compliance status for clients already on the books.',
    icon: Users,
    tone: 'var(--tone-emerald)',
    keywords: ['existing', 're-verification', 'compliance', 'review', 'renewal'],
    soon: {
      title: 'Existing clients',
      body: 'Periodic re-verification for clients already fuelling — who is due for review, and what changed since they were approved. Reads the same carrier spine Finance and Sales use, so the figures reconcile.',
      sources: ['octane.dim_company', 'verification DB'],
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
