import 'dotenv/config';
/**
 * Seed the Octane Scope risk items with the values the widget currently hardcodes, so the first
 * load isn't empty. Idempotent: a node that already has items is skipped (so re-running is safe and
 * won't duplicate or clobber edits made from the widget). Run: `pnpm seed:scope-risks`.
 */
import { DEFAULT_TENANT_ID } from '../src/config/constants.js';
import { closeDb } from '../src/db/client.js';
import { logger } from '../src/lib/logger.js';
import { scopesForRole } from '../src/modules/auth/permissions.js';
import { scopeRiskRepo, type CreateScopeRiskInput } from '../src/repos/scopeRiskRepo.js';
import type { ScopeRiskCategory } from '../src/db/schema/index.js';
import type { TenantContext } from '../src/types/tenantContext.js';

function cliContext(): TenantContext {
  return {
    tenantId: DEFAULT_TENANT_ID,
    userId: 'cli',
    audience: 'internal',
    role: 'admin',
    scopes: scopesForRole('admin'),
    departments: [],
    allDepartmentAccess: true,
    requestId: 'cli-seed-scope-risks',
  };
}

/** Default icon per category (the widget maps the key; these are from its icon set). */
const ICON: Record<ScopeRiskCategory, string> = { blocker: 'ban', red_flag: 'flag', manual: 'clipboard' };

const SEED: Record<string, Record<ScopeRiskCategory, string[]>> = {
  'lead-generation': {
    blocker: ['Invalid or unreachable contact info', 'Offline source not integrated (manual-entry gap)'],
    red_flag: ['Same lead arrives from multiple channels', 'Spike of low-quality / spam leads'],
    manual: ['Manual lead creation for offline sources', 'Manual de-duplication checks'],
  },
  'lead-cycle': {
    blocker: ['Invalid or missing phone number', 'Duplicate lead already in the pipeline'],
    red_flag: ['3 calls with no answer', 'Lead asked to not be contacted'],
    manual: ['Agent manually logs each call outcome', 'Bulk SMS triggered manually for chosen segments'],
  },
  'wex-cycle': {
    blocker: ['Incomplete application returned by WEX', 'Approval event delayed or missing'],
    red_flag: ['Application stuck in review past SLA', 'Lead not found in CRM at conversion'],
    manual: ['CS re-instructs the client on incomplete apps', 'Manual lead creation when the match fails'],
  },
  'deal-cycle': {
    blocker: ['Billing form not filled by the client', 'Card funding not completed'],
    red_flag: ['Deal stalled between pipeline stages', 'Cards sent but not delivered'],
    manual: ['Manual verification / approval review', 'Manual follow-up on unfunded cards'],
  },
};

async function main(): Promise<void> {
  const ctx = cliContext();
  let created = 0;
  for (const [nodeId, byCategory] of Object.entries(SEED)) {
    const existing = await scopeRiskRepo.countForNode(ctx, nodeId);
    if (existing > 0) {
      logger.info({ nodeId, existing }, 'scope-risks: node already has items, skipping');
      continue;
    }
    for (const [category, labels] of Object.entries(byCategory) as [ScopeRiskCategory, string[]][]) {
      for (const label of labels) {
        const input: CreateScopeRiskInput = { nodeId, category, label, icon: ICON[category] };
        await scopeRiskRepo.create(ctx, input);
        created += 1;
      }
    }
    logger.info({ nodeId }, 'scope-risks: seeded node');
  }
  logger.info({ created }, 'scope-risks: seed complete');
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    logger.error({ err }, 'seed-scope-risks failed');
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
