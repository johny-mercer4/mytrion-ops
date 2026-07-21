import { describe, expect, it } from 'vitest';
import {
  CRON_SCHEDULES,
  DISABLED_JOB_QUEUES,
  MANUAL_TRIGGERABLE_QUEUES,
  retentionCaseSyncJob,
} from '../../src/modules/jobs/catalog.js';
import { humanizeCron } from '../../src/modules/jobs/jobCatalogMeta.js';
import { listJobCatalog } from '../../src/modules/jobs/status.js';

describe('jobs admin catalog', () => {
  it('schedules retention case-sync every hour', () => {
    const entry = CRON_SCHEDULES.find((s) => s.name === retentionCaseSyncJob.name);
    expect(entry?.cron).toBe('0 * * * *');
  });

  it('humanizes cron into plain English', () => {
    expect(humanizeCron('0 * * * *', 'America/Chicago')).toBe(
      'Every hour (America/Chicago)',
    );
    expect(humanizeCron('0 */2 * * *', 'America/Chicago')).toBe(
      'Every 2 hours (America/Chicago)',
    );
    expect(humanizeCron('0 8 * * 1-5', 'America/Chicago')).toBe(
      'Weekdays at 8:00 AM (America/Chicago)',
    );
    expect(humanizeCron('0 9 * * 1', 'America/Chicago')).toBe(
      'Every Monday at 9:00 AM (America/Chicago)',
    );
    expect(humanizeCron('15 * * * *', 'America/Chicago')).toBe(
      'Every hour at :15 (America/Chicago)',
    );
    expect(humanizeCron('0 7 * * *', 'America/Chicago')).toBe(
      'Every day at 7:00 AM (America/Chicago)',
    );
  });

  it('lists every catalog queue with titles, schedules, and active flags', () => {
    const live = new Set([retentionCaseSyncJob.name, 'maintenance.approvals-expiry']);
    const catalog = listJobCatalog({ jobsEnabled: true, liveScheduleNames: live });
    expect(catalog.length).toBeGreaterThanOrEqual(8);
    const sync = catalog.find((j) => j.name === retentionCaseSyncJob.name);
    expect(sync).toMatchObject({
      name: retentionCaseSyncJob.name,
      title: 'Retention case sync',
      cron: '0 * * * *',
      trigger: 'cron',
      triggerLabel: 'Scheduled (cron)',
      scheduleLabel: expect.stringContaining('Every hour'),
      active: true,
      statusLabel: 'Active',
      manualTriggerable: true,
    });
    expect(sync?.description.length).toBeGreaterThan(20);

    const weekly = catalog.find((j) => j.name === 'automation.retention.weekly-scan');
    expect(DISABLED_JOB_QUEUES.has('automation.retention.weekly-scan')).toBe(true);
    expect(weekly).toMatchObject({
      active: false,
      statusLabel: 'Disabled',
      manualTriggerable: false,
      scheduleLabel: 'Disabled (not scheduled)',
    });
    expect(CRON_SCHEDULES.some((s) => s.name === 'automation.retention.weekly-scan')).toBe(false);

    for (const j of catalog) {
      expect(j.manualTriggerable).toBe(MANUAL_TRIGGERABLE_QUEUES.has(j.name));
      expect(j.title.length).toBeGreaterThan(0);
      expect(j.scheduleLabel.length).toBeGreaterThan(0);
    }
  });

  it('labels on-demand and dead-letter queues (not cron)', () => {
    const catalog = listJobCatalog({ jobsEnabled: true, liveScheduleNames: new Set() });
    expect(catalog.find((j) => j.name === 'agent.run')).toMatchObject({
      trigger: 'on_demand',
      cron: null,
      manualTriggerable: false,
      active: true,
      statusLabel: 'Ready — waits for a trigger',
      scheduleLabel: expect.stringContaining('agent task'),
    });
    expect(catalog.find((j) => j.name === 'knowledge.bulk-ingest')).toMatchObject({
      trigger: 'on_demand',
      cron: null,
      manualTriggerable: false,
    });
    expect(catalog.find((j) => j.name === 'jobs.dead')).toMatchObject({
      trigger: 'dead_letter',
      cron: null,
      manualTriggerable: false,
      active: true,
    });
  });

  it('marks everything inactive when jobs are disabled', () => {
    const catalog = listJobCatalog({ jobsEnabled: false });
    expect(catalog.every((j) => j.active === false)).toBe(true);
    expect(catalog[0]?.statusLabel).toContain('Off');
  });

  it('parses retention case-sync payload for manual backfill', () => {
    const parsed = retentionCaseSyncJob.schema.parse({
      lookbackDays: 90,
      limit: 1000,
      trigger: 'manual',
    });
    expect(parsed).toEqual({ lookbackDays: 90, limit: 1000, trigger: 'manual' });
    expect(retentionCaseSyncJob.schema.parse({})).toEqual({});
  });

  it('does not allow agent.run or dead-letter via Admin trigger set', () => {
    expect(MANUAL_TRIGGERABLE_QUEUES.has('agent.run')).toBe(false);
    expect(MANUAL_TRIGGERABLE_QUEUES.has('jobs.dead')).toBe(false);
    expect(MANUAL_TRIGGERABLE_QUEUES.has('knowledge.bulk-ingest')).toBe(false);
  });
});
