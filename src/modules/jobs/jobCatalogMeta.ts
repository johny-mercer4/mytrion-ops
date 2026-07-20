/**
 * Human-facing labels for the Admin Jobs catalog — what each queue does, and
 * plain-English schedules (instead of raw cron).
 */
import { env } from '../../config/env.js';

/** How the queue is normally fed — cron schedule, API/event enqueue, or dead-letter sink. */
export type JobTriggerKind = 'cron' | 'on_demand' | 'dead_letter';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export interface JobMeta {
  title: string;
  description: string;
}

const META: Record<string, JobMeta> = {
  'agent.run': {
    title: 'Agent chat run',
    description: 'Runs an AI agent reply in the background when someone starts an async agent task.',
  },
  'knowledge.bulk-ingest': {
    title: 'Knowledge bulk ingest',
    description: 'Parses and embeds a large knowledge file after you upload it in Admin → Train.',
  },
  'jobs.dead': {
    title: 'Failed-job sink',
    description: 'Catches jobs that exhausted retries. Records an audit entry and marks linked tasks failed.',
  },
  'automation.retention.case-sync': {
    title: 'Retention case sync',
    description:
      'Hourly DWH scan: opens Phase-1 cases on frequency breach, refreshes metrics, and auto-closes Returned when the client fuels again.',
  },
  'automation.retention.deadline-sweep': {
    title: 'Retention deadline sweep',
    description:
      'Every 15 minutes: applies overdue timers — 2BD no-action → Retention, Reached 5BD → Open Pool, pool 3BD claim, vacation follow-up / Ops signoff, 10BD Retention → CITI. Notifies Ryan Saab (inbox) on Open Pool.',
  },
  'automation.retention.weekly-scan': {
    title: 'Retention weekly scan',
    description: 'Monday LLM summary of churn-risk signals and re-engagement actions for the retention team.',
  },
  'automation.collection.debtor-sweep': {
    title: 'Collection debtor sweep',
    description: 'Weekday LLM summary of the debtor list — totals, hard debtors, and urgent follow-ups.',
  },
  'automation.verification.recheck-reminders': {
    title: 'Verification recheck reminders',
    description: 'Daily LLM reminder of verification rechecks due and anything blocking applications.',
  },
  'maintenance.approvals-expiry': {
    title: 'Approvals expiry',
    description: 'Expires write-approvals that sat pending longer than 24 hours.',
  },
  'maintenance.memory-decay': {
    title: 'Agent memory decay',
    description: 'Decays agent-memory importance scores and removes faded or expired memories.',
  },
  'maintenance.checkpoint-ttl-sweep': {
    title: 'Checkpoint cleanup',
    description: 'Deletes idle LangGraph agent checkpoints past the configured retention window.',
  },
};

export function jobMeta(name: string): JobMeta {
  return (
    META[name] ?? {
      title: name,
      description: 'Background queue registered in the job catalog.',
    }
  );
}

function formatClock(hour: string, minute: string): string {
  const h = Number(hour);
  const m = Number(minute);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return `${hour}:${minute}`;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}:00 ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Turn a 5-field cron into plain English. Falls back to the raw expression. */
export function humanizeCron(cron: string, tz: string = env.JOBS_CRON_TZ): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts as [string, string, string, string, string];
  const zone = tz ? ` (${tz})` : '';

  if (min === '0' && hour.startsWith('*/') && dom === '*' && mon === '*' && dow === '*') {
    const n = hour.slice(2);
    return n === '1' ? `Every hour${zone}` : `Every ${n} hours${zone}`;
  }
  if (hour === '*' && dom === '*' && mon === '*' && dow === '*' && /^\d+$/.test(min)) {
    return min === '0'
      ? `Every hour${zone}`
      : `Every hour at :${min.padStart(2, '0')}${zone}`;
  }
  if (dom === '*' && mon === '*' && dow === '*' && /^\d+$/.test(min) && /^\d+$/.test(hour)) {
    return `Every day at ${formatClock(hour, min)}${zone}`;
  }
  if (dom === '*' && mon === '*' && dow === '1-5' && /^\d+$/.test(min) && /^\d+$/.test(hour)) {
    return `Weekdays at ${formatClock(hour, min)}${zone}`;
  }
  if (dom === '*' && mon === '*' && /^\d+$/.test(dow) && /^\d+$/.test(min) && /^\d+$/.test(hour)) {
    const day = DAY_NAMES[Number(dow)] ?? `day ${dow}`;
    return `Every ${day} at ${formatClock(hour, min)}${zone}`;
  }
  return `${cron}${zone}`;
}

export function triggerKindLabel(kind: JobTriggerKind): string {
  if (kind === 'cron') return 'Scheduled (cron)';
  if (kind === 'dead_letter') return 'System (dead letter)';
  return 'On demand (triggered)';
}

export function scheduleLabelFor(opts: {
  trigger: JobTriggerKind;
  cron: string | null;
  name: string;
}): string {
  if (opts.trigger === 'cron' && opts.cron) return humanizeCron(opts.cron);
  if (opts.trigger === 'dead_letter') return 'Whenever a job fails permanently';
  if (opts.name === 'agent.run') return 'When an async agent task is created';
  if (opts.name === 'knowledge.bulk-ingest') return 'When a Train upload is queued';
  return 'When something enqueues this queue';
}
