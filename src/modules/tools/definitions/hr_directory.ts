/**
 * HR read tools.
 *
 * Until now NOTHING in the tool catalog touched `hr_employees`, `hr_leave_*` or the attendance
 * tables — the only employee-shaped tool was `zoho_people.search_employees`, which reads LIVE Zoho
 * People and is bound solely to the manager agent. So an HR user had no conversational access to
 * their own module, and a chat answer about staff could contradict the HR Mytrion, because the
 * Mytrion renders the local `hr_employees` mirror while that tool read Zoho directly.
 *
 * These read the same mirror the HR Mytrion shows, so the assistant and the screen agree.
 *
 * RBAC follows the module's real gates rather than inventing one:
 *   - the DIRECTORY is `hr`-department-gated, matching `requireHrInternal` on /v1/hr/* — it was
 *     historically audience-only, which let every signed-in worker read all employee rows;
 *   - TIME OFF for YOURSELF is audience-only, matching `requireTimeOffInternal`, because owner
 *     scoping happens downstream in `resolveTimeOffEmployee` (it resolves the caller's OWN row from
 *     `zoho:<id>` and can return nobody else's).
 * Both are riskClass 'read'; nothing here writes.
 */
import { z } from 'zod';
import { hrEmployeeRepo } from '../../../repos/hrEmployeeRepo.js';
import { getTimeOffOverview } from '../../hr/leave/service.js';
import type { ToolManifest } from '../types.js';

const findInput = z.object({
  query: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe('Name, email or employee number. Omit to list by department/status.'),
  department: z.string().min(1).max(80).optional().describe('Filter by department name'),
  status: z.string().min(1).max(40).optional().describe('e.g. Active'),
  limit: z.number().int().min(1).max(50).default(20),
});

const employeeShape = z.object({
  employeeNumber: z.string().nullable(),
  name: z.string(),
  email: z.string().nullable(),
  designation: z.string().nullable(),
  department: z.string().nullable(),
  status: z.string().nullable(),
  /** Present only when the employee is linked to a CRM sign-in — the People↔CRM id bridge. */
  hasPortalLogin: z.boolean(),
});

const findOutput = z.object({
  count: z.number(),
  employees: z.array(employeeShape),
  note: z.string(),
});

export const hrFindEmployeeTool: ToolManifest<z.infer<typeof findInput>, z.infer<typeof findOutput>> = {
  name: 'hr.find_employee',
  description:
    'Search the Octane employee directory by name, email or employee number, or list by department ' +
    "or status. Returns role, department, status and whether they have a portal login. Reads the " +
    'HR directory (the same records the HR Mytrion shows), not live Zoho People. Internal HR use.',
  inputSchema: findInput,
  outputSchema: findOutput,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: [],
  // Mirrors requireHrInternal on /v1/hr/*: holding the `hr` grant (or allDepartmentAccess) is what
  // opens the directory. Without this every internal caller could read all employee rows.
  allowedDepartments: ['hr'],
  rateLimit: { perMinute: 20 },
  async handler(input, ctx) {
    const rows = await hrEmployeeRepo.list(ctx, {
      ...(input.query ? { q: input.query } : {}),
      ...(input.department ? { department: input.department } : {}),
      ...(input.status ? { status: input.status } : {}),
      limit: input.limit,
    });
    return {
      count: rows.length,
      employees: rows.map((r) => ({
        employeeNumber: r.employeeId ?? null,
        name: `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim(),
        email: r.email ?? null,
        designation: r.designation ?? null,
        department: r.department ?? null,
        status: r.status ?? null,
        hasPortalLogin: Boolean(r.zohoUserId),
      })),
      note:
        'Directory data is a one-way mirror of Zoho People and can lag a sync. It carries no salary, ' +
        'compensation, contract or document information — none of that exists in this system.',
    };
  },
};

const timeOffInput = z.object({
  year: z
    .number()
    .int()
    .min(2000)
    .max(2100)
    .optional()
    .describe('Leave year. Defaults to the current year.'),
});

const timeOffOutput = z.record(z.unknown());

export const hrMyTimeOffTool: ToolManifest<z.infer<typeof timeOffInput>, z.infer<typeof timeOffOutput>> = {
  name: 'hr.my_time_off',
  description:
    "The CALLER'S OWN time-off position: leave entitlements, days taken and remaining per leave " +
    'type, plus company holidays for the year. Use for "how many vacation days do I have left", ' +
    '"my leave balance", "when are the holidays". Always the caller — it cannot report anyone else.',
  inputSchema: timeOffInput,
  outputSchema: timeOffOutput,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: [],
  // Deliberately NOT department-gated, matching requireTimeOffInternal: any internal worker may see
  // their OWN leave. `resolveTimeOffEmployee` resolves the caller's own employee row from their
  // session id, so this cannot return another person's balance regardless of who calls it.
  rateLimit: { perMinute: 20 },
  async handler(input, ctx) {
    // The overview already reports the year its balances were computed for, so it is returned as-is
    // rather than merged with a second copy that could disagree.
    const overview = await getTimeOffOverview(ctx, input.year ?? new Date().getUTCFullYear());
    return overview as unknown as Record<string, unknown>;
  },
};
