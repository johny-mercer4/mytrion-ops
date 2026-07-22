/**
 * Registration manifest — the wrappers /v1/health/integrations reports on. Importing the
 * vendor modules here is cheap by contract (constructors touch no env/sockets); the ONE
 * exception is Composio, whose SDK import is heavy and FF-gated, so it registers as a lazy
 * handle that only imports composio.ts when configured AND asked.
 *
 * New integration? Add its singleton here (see core/base.ts header for the recipe).
 */
import { env } from '../../config/env.js';
import { cmpDb } from '../awsMysql.js';
import { browserAutomation } from '../browserAutomation.js';
import { cmp } from '../cmp.js';
import { dwh } from '../dwh.js';
import { internalDb } from '../internalDb.js';
import { ringcentral } from '../ringcentral.js';
import { serverCrm } from '../serverCrm.js';
import { zapier } from '../zapier.js';
import { zohoCrm } from '../zohoCrm.js';
import { zohoDesk } from '../zohoDesk.js';
import { zohoPeople } from '../zohoPeople.js';
import { registerWrapper } from './registry.js';

let registered = false;

export function registerAllWrappers(): void {
  if (registered) return;
  registered = true;
  registerWrapper(internalDb);
  registerWrapper(dwh);
  registerWrapper(cmpDb);
  registerWrapper(cmp);
  registerWrapper(serverCrm);
  registerWrapper(browserAutomation);
  registerWrapper(zapier);
  registerWrapper(zohoCrm);
  registerWrapper(zohoDesk);
  registerWrapper(zohoPeople);
  registerWrapper(ringcentral);
  registerWrapper({
    name: 'composio',
    kind: 'sdk',
    isConfigured: () => env.FF_COMPOSIO_ENABLED && Boolean(env.COMPOSIO_API_KEY),
    load: async () => (await import('../composio.js')).composio,
  });
}
