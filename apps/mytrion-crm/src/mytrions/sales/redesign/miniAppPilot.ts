/**
 * Sales mini-app pilot roster — the CRM's copy.
 *
 * DECORATION, NOT A GATE. The server decides (`src/modules/carrier/salesMiniAppPilot.ts`); this list
 * exists so an agent outside the pilot is not shown a button that answers 403. Keep the ids in step
 * with the server list — they are the same roster, and the server is the one that matters.
 */
import { getImpersonation } from '@/api/impersonation';
import { getSession } from '@/api/session';

const PILOT_ZOHO_USER_IDS = new Set([
  '6227679000031473048', // Daniel Brown
]);

/**
 * Admins see the controls (Admin Client Management onboards outside the pilot), except while
 * viewing as someone — "View as" shows that agent's Sales, pilot membership included.
 */
export function isMiniAppPilotAgent(): boolean {
  const actingAs = getImpersonation()?.zohoUserId;
  if (actingAs) return PILOT_ZOHO_USER_IDS.has(actingAs);
  const worker = getSession()?.worker;
  if (!worker) return false;
  if (worker.allDepartmentAccess || (worker.role ?? '').toLowerCase().includes('admin')) return true;
  return PILOT_ZOHO_USER_IDS.has(worker.zohoUserId);
}
