import { closeDb } from '../src/db/client.js';
import { DEFAULT_TENANT_ID } from '../src/config/constants.js';
import { scrubStoredTouchpointPans } from '../src/modules/audit/touchpointPanScrub.js';
import type { TenantContext } from '../src/types/tenantContext.js';

const maxRows = Number(process.env.PAN_SCRUB_MAX_ROWS ?? 10_000);
const ctx: TenantContext = {
  tenantId: DEFAULT_TENANT_ID,
  userId: 'system:audit-pan-scrub',
  audience: 'internal',
  role: 'admin',
  scopes: [],
  departments: [],
  allDepartmentAccess: true,
  requestId: 'audit-pan-scrub',
};

try {
  const scrubbed = await scrubStoredTouchpointPans(ctx, { maxRows });
  console.log(`Scrubbed ${scrubbed} touchpoint audit PAN value(s).`);
} finally {
  await closeDb();
}
