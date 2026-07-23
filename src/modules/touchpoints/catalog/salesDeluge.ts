/**
 * User-keyed + sales-flow Deluge touchpoints — session/dashboards/home/inbox/leads.
 * Entries with identityParam get the caller's Zoho user id injected server-side
 * (session-authoritative; only admins may target another user).
 */
import { z } from 'zod';
import {
  fetchAgentSalesDashboard,
  fetchCompanyDashboard,
  fetchDebtorsInfo,
  fetchHomeSnapshot,
} from '../../../integrations/salesDashboards.js';
import {
  createLead,
  deleteInboxMessage,
  fetchAnnouncements,
  fetchApplicationUpdate,
  fetchInbox,
} from '../../../integrations/salesCrmActions.js';
import type { Touchpoint } from '../types.js';
import { idString, SALES, shortText, ymdDate } from './common.js';

const userKeyed = z.object({ userId: idString.optional() });

export const salesDelugeTouchpoints: Touchpoint[] = [
  {
    kind: 'deluge',
    key: 'user.callback',
    title: 'Mytrion user context (profile, carriers, applications)',
    riskClass: 'read',
    departments: SALES,
    identityParam: 'userId',
    functionNames: ['mytrionCallback'],
    unwrap: 'status',
    paramsSchema: userKeyed,
  },
  // application.update / leads.create migrated off Zoho Deluge to native Zoho-CRM calls (kind: 'local',
  // src/integrations/salesCrmActions.ts). Return shapes are byte-compatible with the old Deluge output.
  {
    kind: 'local',
    key: 'application.update',
    title: 'WEX application tasks fetch',
    riskClass: 'read',
    departments: SALES,
    paramsSchema: z.object({ appId: idString }),
    handler: (_ctx, params) => fetchApplicationUpdate(String(params.appId)),
  },
  {
    kind: 'local',
    key: 'leads.create',
    title: 'Create Lead in CRM',
    riskClass: 'write',
    departments: SALES,
    identityParam: 'userId',
    paramsSchema: z.object({
      userId: idString.optional(),
      createPayload: z
        .object({
          // firstName + phone are legitimately blank for broker-snapshot leads (the widget's
          // First-name field is optional and many FMCSA rows carry no phone) — only lastName +
          // companyName are required.
          firstName: z.string().max(100).optional(),
          lastName: shortText(100),
          companyName: shortText(300),
          phone: z.string().max(30).optional(),
        })
        .passthrough(), // optional extras: email, dot, fullAddress, truckSize, salutation, …
    }),
    // A DUPLICATE_DATA failure returns { success:false, response } carrying the EXISTING lead id — the
    // UI (resolveCreateLeadOutcome) pulls it from `response` to link the existing lead.
    handler: (_ctx, params) =>
      createLead(String(params.userId ?? ''), (params.createPayload as Record<string, unknown>) ?? {}),
  },
  // Dashboards — migrated off Zoho Deluge to native TypeScript (kind: 'local'). Each handler does the
  // same orchestration the Deluge function did (servercrm DWH endpoints + Zoho COQL) but skips the Zoho
  // user-lookup (the display name is on the session: ctx.userName) and the Zoho function round-trip. The
  // RETURN SHAPES are byte-compatible with the old Deluge output, so the frontend parsers are unchanged.
  // See src/integrations/salesDashboards.ts. userId is the session-authoritative id (identityParam).
  {
    kind: 'local',
    key: 'dashboard.company',
    title: 'Company-wide dashboard',
    riskClass: 'read',
    departments: SALES,
    identityParam: 'userId',
    paramsSchema: userKeyed,
    handler: async (ctx) => fetchCompanyDashboard(ctx.userName?.trim() ?? ''),
  },
  {
    kind: 'local',
    key: 'dashboard.debtors',
    title: 'Debtors dashboard',
    riskClass: 'read',
    departments: SALES,
    identityParam: 'userId',
    paramsSchema: userKeyed,
    handler: async (ctx, params) =>
      fetchDebtorsInfo(String(params.userId ?? ''), ctx.userName?.trim() ?? '', {
        summaryOnly: params.summaryOnly === true,
      }),
  },
  {
    kind: 'local',
    key: 'dashboard.agent_sales',
    title: 'Agent sales dashboard',
    riskClass: 'read',
    departments: SALES,
    identityParam: 'userId',
    paramsSchema: z.object({
      userId: idString.optional(),
      startDate: ymdDate.optional(),
      endDate: ymdDate.optional(),
    }),
    handler: async (ctx) => fetchAgentSalesDashboard(ctx.userName?.trim() ?? ''),
  },
  {
    kind: 'local',
    key: 'dashboard.home_snapshot',
    title: 'Home page snapshot',
    riskClass: 'read',
    departments: SALES,
    identityParam: 'userId',
    paramsSchema: userKeyed,
    handler: async (ctx, params) => fetchHomeSnapshot(String(params.userId ?? ''), ctx.userName?.trim() ?? ''),
  },
  // Announcements + inbox migrated off Zoho Deluge to native Zoho-CRM calls (kind: 'local',
  // src/integrations/salesCrmActions.ts). Return shapes are byte-compatible with the old Deluge output.
  {
    kind: 'local',
    key: 'inbox.announcements',
    title: 'Announcements feed',
    riskClass: 'read',
    departments: SALES,
    paramsSchema: z.object({}),
    handler: () => fetchAnnouncements(),
  },
  {
    kind: 'local',
    key: 'inbox.list',
    title: 'CRM inbox messages',
    riskClass: 'read',
    departments: SALES,
    identityParam: 'userId',
    paramsSchema: userKeyed,
    handler: (_ctx, params) => fetchInbox(String(params.userId ?? '')),
  },
  {
    kind: 'local',
    key: 'inbox.delete_message',
    title: 'Delete a CRM inbox message',
    riskClass: 'write',
    departments: SALES,
    paramsSchema: z.object({ recordId: idString }),
    handler: (_ctx, params) => deleteInboxMessage(String(params.recordId)),
  },
  {
    kind: 'deluge',
    key: 'leads.datacenter',
    title: 'Data Center leads (converted / unconverted)',
    riskClass: 'read',
    departments: SALES,
    identityParam: 'userId',
    functionNames: ['mytriondatacenterleads'],
    unwrap: 'permissive',
    paramsSchema: userKeyed,
  },
];
