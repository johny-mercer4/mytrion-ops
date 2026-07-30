import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const RECRUIT_JOB_STATUSES = ['draft', 'open', 'paused', 'closed'] as const;
export type RecruitJobStatus = (typeof RECRUIT_JOB_STATUSES)[number];

export const RECRUIT_EMPLOYMENT_TYPES = [
  'full_time',
  'part_time',
  'contract',
  'internship',
] as const;
export type RecruitEmploymentType = (typeof RECRUIT_EMPLOYMENT_TYPES)[number];

export const recruitJobOpenings = pgTable(
  'recruit_job_openings',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `rjo_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    openingCode: text('opening_code'),
    title: text('title').notNull(),
    departmentId: text('department_id').notNull(),
    departmentName: text('department_name').notNull(),
    hiringManagerEmployeeId: text('hiring_manager_employee_id'),
    employmentType: text('employment_type').$type<RecruitEmploymentType>().notNull().default('full_time'),
    location: text('location'),
    status: text('status').$type<RecruitJobStatus>().notNull().default('draft'),
    headcount: integer('headcount').notNull().default(1),
    description: text('description'),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantCodeUk: uniqueIndex('recruit_job_openings_tenant_code_uk')
      .on(table.tenantId, table.openingCode)
      .where(sql`${table.openingCode} IS NOT NULL`),
    tenantStatusIdx: index('recruit_job_openings_tenant_status_idx').on(
      table.tenantId,
      table.status,
      table.updatedAt,
    ),
    tenantDepartmentIdx: index('recruit_job_openings_tenant_department_idx').on(
      table.tenantId,
      table.departmentId,
    ),
  }),
);

export type RecruitJobOpening = typeof recruitJobOpenings.$inferSelect;
export type NewRecruitJobOpening = typeof recruitJobOpenings.$inferInsert;
