/**
 * Typed enqueue: payloads are zod-parsed BEFORE they hit pg-boss, so a malformed producer
 * fails at send time (loudly, in the request) rather than at work time (silently, in a worker).
 */
import type { SendOptions } from 'pg-boss';
import type { z } from 'zod';
import { getBoss } from './boss.js';
import type { JobDef } from './catalog.js';

export interface EnqueueOptions {
  /** Dedup key (queue-policy dependent). */
  singletonKey?: string;
  startAfterSeconds?: number;
  priority?: number;
}

export async function enqueue<S extends z.ZodTypeAny>(
  job: JobDef<S>,
  payload: z.infer<S>,
  opts: EnqueueOptions = {},
): Promise<string> {
  const data = job.schema.parse(payload) as object;
  const sendOptions: SendOptions = {
    ...(opts.singletonKey !== undefined ? { singletonKey: opts.singletonKey } : {}),
    ...(opts.startAfterSeconds !== undefined ? { startAfter: opts.startAfterSeconds } : {}),
    ...(opts.priority !== undefined ? { priority: opts.priority } : {}),
  };
  const jobId = await getBoss().send(job.name, data, sendOptions);
  if (!jobId) throw new Error(`enqueue rejected (duplicate singleton?) for queue ${job.name}`);
  return jobId;
}
