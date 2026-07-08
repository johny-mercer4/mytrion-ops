import { describe, expect, it } from 'vitest';
import { ALL_JOBS, DEAD_LETTER_QUEUE } from '../../src/modules/jobs/catalog.js';
import { bulkIngestJob } from '../../src/modules/jobs/workers/knowledgeIngest.js';

/**
 * pg-boss v12 createQueue validates a queue's deadLetter target already exists. Reproduce the
 * ordering boss.ts uses and assert every dead-letter target is created before its referrers.
 */
describe('queue creation order (dead-letter safety)', () => {
  it('creates dead-letter targets before any queue that references them', () => {
    const jobs = [...ALL_JOBS, bulkIngestJob];
    const deadLetterNames = new Set(
      jobs.map((j) => j.queue.deadLetter).filter((n): n is string => Boolean(n)),
    );
    const ordered = [...jobs].sort((a, b) => {
      const aDead = deadLetterNames.has(a.name) ? 0 : 1;
      const bDead = deadLetterNames.has(b.name) ? 0 : 1;
      return aDead - bDead;
    });

    const created = new Set<string>();
    for (const job of ordered) {
      if (job.queue.deadLetter) {
        expect(created.has(job.queue.deadLetter), `${job.name} created before ${job.queue.deadLetter}`).toBe(true);
      }
      created.add(job.name);
    }
    // Sanity: the shared dead-letter queue is actually referenced and defined.
    expect(deadLetterNames.has(DEAD_LETTER_QUEUE)).toBe(true);
    expect(jobs.some((j) => j.name === DEAD_LETTER_QUEUE)).toBe(true);
  });
});
