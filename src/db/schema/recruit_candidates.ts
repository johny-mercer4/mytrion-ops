import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const RECRUIT_CANDIDATE_STAGES = [
  'new',
  'screening',
  'interview',
  'offer',
  'hired',
  'rejected',
] as const;
export type RecruitCandidateStage = (typeof RECRUIT_CANDIDATE_STAGES)[number];

export const recruitCandidates = pgTable(
  'recruit_candidates',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `rca_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    jobOpeningId: text('job_opening_id').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    stage: text('stage').$type<RecruitCandidateStage>().notNull().default('new'),
    source: text('source'),
    currentCompany: text('current_company'),
    currentTitle: text('current_title'),
    notes: text('notes'),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
    convertedEmployeeId: text('converted_employee_id'),
    convertedAt: timestamp('converted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantStageIdx: index('recruit_candidates_tenant_stage_idx').on(
      table.tenantId,
      table.stage,
      table.updatedAt,
    ),
    tenantJobIdx: index('recruit_candidates_tenant_job_idx').on(
      table.tenantId,
      table.jobOpeningId,
    ),
    tenantEmployeeUk: uniqueIndex('recruit_candidates_tenant_employee_uk').on(
      table.tenantId,
      table.convertedEmployeeId,
    ).where(sql`${table.convertedEmployeeId} IS NOT NULL`),
  }),
);

export type RecruitCandidate = typeof recruitCandidates.$inferSelect;
export type NewRecruitCandidate = typeof recruitCandidates.$inferInsert;
