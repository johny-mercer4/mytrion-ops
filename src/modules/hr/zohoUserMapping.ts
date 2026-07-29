/**
 * Resolve `hr_employees.zoho_user_id` — which Zoho CRM login belongs to which employee.
 *
 * WHY THIS IS ITS OWN MODULE. Two Zoho products, two id spaces: employees came from Zoho PEOPLE
 * (`zoho_record_id`), while portal sign-in is Zoho CRM OAuth. Nothing links them, and this repo has
 * already been burned by assuming otherwise — DWH by-agent queries had to fall back to matching on
 * NAME because the session's Zoho id matched no `agent_zoho_user_id`.
 *
 * EMAIL IS THE ONLY KEY, and it is a decision, not a discovery: it is the sole field both sides carry.
 * That makes the mapping fallible, so this module is built to fail closed and show its work rather than
 * to maximise matches:
 *
 *   - normalise both sides with LOWER(TRIM(...)) before comparing; nothing fuzzier than that
 *   - an email that is AMBIGUOUS on either side (two CRM users, or two employees) is left UNLINKED and
 *     reported — a wrong link here shows one person another person's private record, which is worse
 *     than an unresolved one
 *   - never overwrite a link an admin set by hand (`zoho_user_id_source = 'manual'`)
 *   - idempotent: re-running changes nothing unless the underlying emails changed
 *
 * The report is the point. Callers should log or surface `unmatchedCrmUsers` / `ambiguous` so the
 * remainder gets bound manually instead of quietly having no access.
 */
import { zohoCrm } from '../../integrations/zohoCrm.js';
import { hrEmployeeRepo } from '../../repos/hrEmployeeRepo.js';
import { logger } from '../../lib/logger.js';
import type { TenantContext } from '../../types/tenantContext.js';

/** Normalised email, or null when there is nothing usable to match on. */
export function normalizeEmail(value: string | null | undefined): string | null {
  const v = (value ?? '').trim().toLowerCase();
  return v.length > 0 && v.includes('@') ? v : null;
}

export interface MappingConflict {
  email: string;
  reason: 'two_or_more_crm_users' | 'two_or_more_employees';
  /** The colliding identities, for the operator who has to resolve it. */
  detail: string;
}

export interface ZohoUserMappingReport {
  crmUsers: number;
  employees: number;
  /** Links written or refreshed this run. */
  linked: number;
  /** Already correct — no write needed. */
  alreadyLinked: number;
  /** Left alone because an admin bound them by hand. */
  manualPreserved: number;
  /** CRM users whose email matches no employee — these people can sign in with no HR identity. */
  unmatchedCrmUsers: Array<{ zohoUserId: string; email: string | null; name: string | null }>;
  /** Employees whose email matches no CRM user — they exist in HR but cannot sign in. */
  unmatchedEmployees: Array<{ id: string; email: string | null; name: string }>;
  /** Employees with no usable email at all — unmappable by this strategy, by definition. */
  employeesWithoutEmail: number;
  /** Emails that could not be resolved safely. */
  ambiguous: MappingConflict[];
}

/** Index a list by normalised email, separating the unique hits from the collisions. */
function indexByEmail<T>(
  items: readonly T[],
  emailOf: (item: T) => string | null,
): { unique: Map<string, T>; collided: Map<string, T[]> } {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const email = emailOf(item);
    if (!email) continue;
    const bucket = buckets.get(email);
    if (bucket) bucket.push(item);
    else buckets.set(email, [item]);
  }
  const unique = new Map<string, T>();
  const collided = new Map<string, T[]>();
  for (const [email, bucket] of buckets) {
    // A one-element bucket is safe to link; anything larger is a decision a human has to make.
    if (bucket.length === 1) unique.set(email, bucket[0] as T);
    else collided.set(email, bucket);
  }
  return { unique, collided };
}

/**
 * Match every CRM user against every employee on normalised email and persist the unambiguous links.
 *
 * `dryRun` computes the identical report without writing, so the numbers can be inspected before any
 * RBAC-bearing column changes.
 */
export async function syncZohoUserMapping(
  ctx: TenantContext,
  opts: { dryRun?: boolean } = {},
): Promise<ZohoUserMappingReport> {
  const dryRun = opts.dryRun === true;
  const [crmUsers, employees] = await Promise.all([
    zohoCrm.listActiveUsers(),
    // Every employee, terminated included: a terminated person may still hold a CRM login, and RBAC
    // needs to resolve them in order to deny them deliberately rather than by accident.
    hrEmployeeRepo.listAllForMapping(ctx),
  ]);

  const crmIdx = indexByEmail(crmUsers, (u) => normalizeEmail(u.email));
  const empIdx = indexByEmail(employees, (e) => normalizeEmail(e.email));

  const report: ZohoUserMappingReport = {
    crmUsers: crmUsers.length,
    employees: employees.length,
    linked: 0,
    alreadyLinked: 0,
    manualPreserved: 0,
    unmatchedCrmUsers: [],
    unmatchedEmployees: [],
    employeesWithoutEmail: employees.filter((e) => normalizeEmail(e.email) === null).length,
    ambiguous: [],
  };

  for (const [email, users] of crmIdx.collided) {
    report.ambiguous.push({
      email,
      reason: 'two_or_more_crm_users',
      detail: users.map((u) => `${u.zohoUserId}${u.name ? ` (${u.name})` : ''}`).join(', '),
    });
  }
  for (const [email, emps] of empIdx.collided) {
    report.ambiguous.push({
      email,
      reason: 'two_or_more_employees',
      detail: emps.map((e) => `${e.id} (${e.firstName} ${e.lastName})`).join(', '),
    });
  }

  for (const [email, user] of crmIdx.unique) {
    const employee = empIdx.unique.get(email);
    if (!employee) {
      // Only report a genuine miss — a collided email is already reported as ambiguous above.
      if (!empIdx.collided.has(email)) {
        report.unmatchedCrmUsers.push({ zohoUserId: user.zohoUserId, email: user.email, name: user.name });
      }
      continue;
    }
    if (employee.zohoUserIdSource === 'manual' && employee.zohoUserId) {
      report.manualPreserved += 1;
      continue;
    }
    if (employee.zohoUserId === user.zohoUserId) {
      report.alreadyLinked += 1;
      continue;
    }
    if (!dryRun) {
      await hrEmployeeRepo.setZohoUserLink(ctx, employee.id, user.zohoUserId, 'email_match');
    }
    report.linked += 1;
  }

  for (const [email, employee] of empIdx.unique) {
    if (crmIdx.unique.has(email) || crmIdx.collided.has(email)) continue;
    report.unmatchedEmployees.push({
      id: employee.id,
      email: employee.email,
      name: `${employee.firstName} ${employee.lastName}`.trim(),
    });
  }

  logger.info(
    {
      dryRun,
      crmUsers: report.crmUsers,
      employees: report.employees,
      linked: report.linked,
      alreadyLinked: report.alreadyLinked,
      manualPreserved: report.manualPreserved,
      unmatchedCrmUsers: report.unmatchedCrmUsers.length,
      unmatchedEmployees: report.unmatchedEmployees.length,
      employeesWithoutEmail: report.employeesWithoutEmail,
      ambiguous: report.ambiguous.length,
    },
    'hr zoho user mapping resolved',
  );
  return report;
}
