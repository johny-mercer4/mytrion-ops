/**
 * Browser-automation touchpoints — BOCA + Close Application (Playwright microservice).
 * Widget parity: POST BROWSER_AUTO /wex/boca/:appId and /wex/application/:appId/close.
 */
import { z } from 'zod';
import type { Touchpoint } from '../types.js';
import { idString } from './common.js';

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
    kind: 'browserauto',
    key: 'browser.boca',
    title: 'Send BOCA link (browser automation)',
    riskClass: 'write',
    method: 'POST',
    pathTemplate: '/wex/boca/{appId}',
    paramsSchema: taskBody,
  },
  {
    kind: 'browserauto',
    key: 'browser.close_application',
    title: 'Close WEX application (browser automation)',
    riskClass: 'write',
    method: 'POST',
    pathTemplate: '/wex/application/{appId}/close',
    paramsSchema: taskBody,
  },
];
