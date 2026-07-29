/**
 * Browser-automation touchpoints — BOCA + Close Application (Playwright microservice).
 * Widget parity: POST BROWSER_AUTO /wex/boca/:appId and /wex/application/:appId/close.
 */
import { z } from 'zod';
import { submitBocaRequest } from '../../browserAutomation/bocaRequest.js';
import { closeWexApplication } from '../../browserAutomation/closeApplication.js';
import type { Touchpoint } from '../types.js';
import { idString, SALES } from './common.js';

const taskBody = z.object({
  appId: idString,
  assignedTo: z.string().max(200).default(''),
  priority: z.enum(['', 'High', 'Normal', 'Low']).default(''),
  dueDate: z
    .string()
    .max(20)
    .refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'dueDate must be YYYY-MM-DD')
    .default(''),
  status: z.string().max(50).default('Not Started'),
});

export const browserAutoTouchpoints: Touchpoint[] = [
  {
    kind: 'local',
    key: 'browser.boca',
    title: 'Send BOCA link (browser automation)',
    riskClass: 'write',
    departments: SALES,
    paramsSchema: taskBody,
    handler: (ctx, params) => submitBocaRequest(ctx, {
      appId: String(params.appId),
      assignedTo: String(params.assignedTo ?? ''),
      priority: params.priority === 'High' || params.priority === 'Normal' || params.priority === 'Low'
        ? params.priority
        : '',
      dueDate: String(params.dueDate ?? ''),
      status: String(params.status ?? 'Not Started'),
    }),
  },
  {
    kind: 'local',
    key: 'browser.close_application',
    title: 'Close WEX application (browser automation)',
    riskClass: 'write',
    departments: SALES,
    paramsSchema: taskBody,
    handler: (_ctx, params) => closeWexApplication(String(params.appId), {
      assignedTo: String(params.assignedTo ?? ''),
      priority: params.priority === 'High' || params.priority === 'Normal' || params.priority === 'Low'
        ? params.priority
        : '',
      dueDate: String(params.dueDate ?? ''),
      status: String(params.status ?? 'Not Started'),
    }),
  },
];
