import { z } from 'zod';
import { searchEmployees } from '../../../integrations/zohoPeople.js';
import type { ToolManifest } from '../types.js';

const inputSchema = z.object({
  /** Filter by employee name — matches first OR last name (partial). Two words → first + last. */
  name: z.string().min(1).max(100).optional(),
  /** Filter by department (partial match). */
  department: z.string().min(1).max(100).optional(),
  /** Max employees to return (default 25). */
  limit: z.number().int().min(1).max(100).optional(),
});

const outputSchema = z.object({
  count: z.number(),
  employees: z.array(
    z.object({
      recordId: z.string(),
      fields: z.record(z.unknown()),
    }),
  ),
});

/**
 * Real tool (Zoho People). Fetch all employees, or filter by name and/or department.
 * Auth + base URL come from the Zoho wrapper (token cached per service).
 */
export const zohoPeopleSearchEmployeesTool: ToolManifest<
  z.infer<typeof inputSchema>,
  z.infer<typeof outputSchema>
> = {
  name: 'zoho_people.search_employees',
  description:
    'Look up employees in Zoho People. Optional filters: `name` (matches first or last name, partial) and `department` (partial). With no filters, returns the first page of all employees. Internal use only.',
  inputSchema,
  outputSchema,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: ['zoho_people:read'],
  rateLimit: { perMinute: 30 },
  async handler(input) {
    const employees = await searchEmployees(input);
    return { count: employees.length, employees };
  },
};
