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
import type { Touchpoint } from '../types.js';
import { idString, shortText, ymdDate } from './common.js';

const userKeyed = z.object({ userId: idString.optional() });

export const salesDelugeTouchpoints: Touchpoint[] = [
  {
    kind: 'deluge',
    key: 'user.callback',
    title: 'Mytrion user context (profile, carriers, applications)',
    riskClass: 'read',
    identityParam: 'userId',
    functionNames: ['mytrionCallback'],
    unwrap: 'status',
    paramsSchema: userKeyed,
  },
  {
    kind: 'deluge',
    key: 'application.update',
    title: 'WEX application tasks fetch',
    riskClass: 'read',
    functionNames: ['mytrionapplicationupdate'],
    unwrap: 'status',
    paramsSchema: z.object({ appId: idString }),
  },
  {
    kind: 'deluge',
    key: 'leads.create',
    title: 'Create Lead in CRM',
    riskClass: 'write',
    identityParam: 'userId',
    functionNames: ['mytrioncreatelead'],
    // Permissive on purpose: the widget inspects {success, leadId, response} itself —
    // a DUPLICATE_DATA failure carries the EXISTING lead id the UI must link to.
    unwrap: 'permissive',
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
    identityParam: 'userId',
    paramsSchema: userKeyed,
    handler: async (ctx) => fetchCompanyDashboard(ctx.userName?.trim() ?? ''),
  },
  {
    kind: 'local',
    key: 'dashboard.debtors',
    title: 'Debtors dashboard',
    riskClass: 'read',
    identityParam: 'userId',
    paramsSchema: userKeyed,
    handler: async (ctx, params) => fetchDebtorsInfo(String(params.userId ?? ''), ctx.userName?.trim() ?? ''),
  },
  {
    kind: 'local',
    key: 'dashboard.agent_sales',
    title: 'Agent sales dashboard',
    riskClass: 'read',
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
    identityParam: 'userId',
    paramsSchema: userKeyed,
    handler: async (ctx, params) => fetchHomeSnapshot(String(params.userId ?? ''), ctx.userName?.trim() ?? ''),
  },
  {
    kind: 'deluge',
    key: 'inbox.announcements',
    title: 'Announcements feed',
    riskClass: 'read',
    functionNames: ['mytrionfetchannouncements'],
    unwrap: 'permissive',
    paramsSchema: z.object({}),
  },
  {
    kind: 'deluge',
    key: 'inbox.list',
    title: 'CRM inbox messages',
    riskClass: 'read',
    identityParam: 'userId',
    functionNames: ['mytrionfetchinbox'],
    unwrap: 'status',
    paramsSchema: userKeyed,
  },
  {
    kind: 'deluge',
    key: 'inbox.delete_message',
    title: 'Delete a CRM inbox message',
    riskClass: 'write',
    functionNames: ['mytriondeleteinboxmessage'],
    unwrap: 'permissive', // widget treats this as fire-and-forget
    paramsSchema: z.object({ recordId: idString }),
  },
  {
    kind: 'deluge',
    key: 'leads.datacenter',
    title: 'Data Center leads (converted / unconverted)',
    riskClass: 'read',
    identityParam: 'userId',
    functionNames: ['mytriondatacenterleads'],
    unwrap: 'permissive',
    paramsSchema: userKeyed,
  },
];
