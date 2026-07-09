/**
 * User-keyed + sales-flow Deluge touchpoints — session/dashboards/home/inbox/leads.
 * Entries with identityParam get the caller's Zoho user id injected server-side
 * (session-authoritative; only admins may target another user).
 */
import { z } from 'zod';
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
    unwrap: 'successFlag',
    paramsSchema: z.object({
      userId: idString.optional(),
      createPayload: z
        .object({
          firstName: shortText(100),
          lastName: shortText(100),
          companyName: shortText(300),
          phone: shortText(30),
        })
        .passthrough(), // optional extras: email, dot, fullAddress, truckSize, salutation, …
    }),
  },
  {
    kind: 'deluge',
    key: 'dashboard.company',
    title: 'Company-wide dashboard',
    riskClass: 'read',
    identityParam: 'userId',
    functionNames: ['mytrioncompanydashboard'],
    unwrap: 'status',
    paramsSchema: userKeyed,
  },
  {
    kind: 'deluge',
    key: 'dashboard.debtors',
    title: 'Debtors dashboard',
    riskClass: 'read',
    identityParam: 'userId',
    functionNames: ['mytriondbdebtorsinfo'],
    unwrap: 'permissive', // response is {debtors, total_debtors, …} with no status wrapper
    paramsSchema: userKeyed,
  },
  {
    kind: 'deluge',
    key: 'dashboard.agent_sales',
    title: 'Agent sales dashboard',
    riskClass: 'read',
    identityParam: 'userId',
    functionNames: ['mytrionAgentSalesDashboard'],
    unwrap: 'successFlag',
    paramsSchema: z.object({
      userId: idString.optional(),
      startDate: ymdDate.optional(),
      endDate: ymdDate.optional(),
    }),
  },
  {
    kind: 'deluge',
    key: 'dashboard.home_snapshot',
    title: 'Home page snapshot',
    riskClass: 'read',
    identityParam: 'userId',
    functionNames: ['mytrionhomesnapshot'],
    unwrap: 'permissive', // array-or-object payload
    paramsSchema: userKeyed,
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
