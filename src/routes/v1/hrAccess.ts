/**
 * Shared HR route surface: the two gates and the employee DTO.
 *
 * Extracted so `hr.routes.ts` and `hrPeople.routes.ts` cannot drift apart on either. A second copy of
 * `requireHrAdmin` is exactly the kind of duplication that ends with one file's writes checking
 * all-department access and the other's checking only the department grant.
 */
import type { FastifyRequest } from 'fastify';
import { RBACError } from '../../lib/errors.js';
import type { HrEmployeeRow } from '../../repos/hrEmployeeRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment, requireInternal } from './helpers.js';

/**
 * READ the people directory — Employees, Departments, Org structure. Any signed-in INTERNAL worker.
 *
 * This is deliberately company-wide: the directory is a shared org resource, so every employee may look
 * up a colleague, their department and the org chart. It was HR-department-only for a while (to keep
 * contact PII off unrelated desks); the org made the call to open the directory to all staff. Managing
 * it — create / edit / delete — stays gated (`requireHrManage`), and Attendance, Time-off approvals and
 * Settings keep their own, narrower gates. Customers (audience !== internal) are still refused.
 */
export function requireHrRead(request: FastifyRequest): TenantContext {
  return requireInternal(request, 'HR directory');
}

/**
 * The 'hr' department grant — "HR staff". Distinct from `requireHrRead` (everyone) and `requireHrManage`
 * (write). Kept for the surfaces that are HR-team-only rather than company-wide or admin-only.
 */
export function requireHrInternal(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'hr', 'HR directory');
}

/**
 * Infrastructure writes — Zoho sync, identity linking, migrations. Mytrion Admin (all-department) only.
 *
 * Kept distinct from `requireHrManage`: an HR Manager runs the people directory, but pulling from Zoho
 * or binding an employee to a sign-in identity is platform plumbing that stays with full admins.
 */
export function requireHrAdmin(request: FastifyRequest): TenantContext {
  const ctx = requireHrInternal(request);
  if (!ctx.allDepartmentAccess && !ctx.bypassRbac && ctx.role !== 'admin') {
    throw new RBACError('Mytrion Admin access required to change employees');
  }
  return ctx;
}

/**
 * Manage the HR directory — create / edit / delete employees and departments, move the org chart.
 *
 * Admins, and **HR Managers**: a user granted HR in `full` mode (Admin → User Management). This is
 * deliberately fail-CLOSED and asks for an EXPLICIT `full`, not merely "not read": the mode resolver
 * defaults HR to `read` (READ_DEFAULT_MYTRIONS), so a plain directory grant — and any token that never
 * baked an HR mode at all — lands here as a non-manager. That is the whole point of the HR default
 * flip: a new HR hire looks but cannot change, until an admin promotes them. Mirrors the client's
 * `canManageHr` exactly, so the hidden button and the 403 always agree.
 */
export function requireHrManage(request: FastifyRequest): TenantContext {
  const ctx = requireHrInternal(request);
  if (ctx.allDepartmentAccess || ctx.bypassRbac || ctx.role === 'admin') return ctx;
  if (ctx.mytrionAccessModes?.hr === 'full') return ctx;
  throw new RBACError('HR Manager access required — ask an admin to grant you HR “Full access”');
}

export function hrEmployeeDto(row: HrEmployeeRow) {
  return {
    id: row.id,
    zohoRecordId: row.zohoRecordId,
    employeeId: row.employeeId,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    departmentId: row.departmentId,
    department: row.department,
    departmentZohoId: row.departmentZohoId,
    designation: row.designation,
    location: row.location,
    status: row.status,
    role: row.role,
    dateOfJoining: row.dateOfJoining,
    mobile: row.mobile,
    faceId: row.faceId,
    telegramUsername: row.telegramUsername,
    reportingTo: row.reportingTo,
    reportingToZohoId: row.reportingToZohoId,
    reportingToEmployeeId: row.reportingToEmployeeId,
    /**
     * The re-hosted avatar, as a `file_assets` id — NOT a URL.
     *
     * `photo_url` (Zoho People's `Photo_downloadUrl`) is deliberately NOT exposed. It is OAuth-gated, so
     * a browser `<img src>` always 401s: every directory render fired 213 doomed requests and then fell
     * back to initials anyway. The column stays on the row for provenance and for a future backfill, but
     * the only avatar the client can actually load is one we host, resolved through `/photo-link`.
     */
    photoFileId: row.photoFileId,
    zohoUserId: row.zohoUserId,
    zohoUserIdSource: row.zohoUserIdSource,
    zohoUserLinkedAt: row.zohoUserLinkedAt?.toISOString() ?? null,
    canvasX: row.canvasX,
    canvasY: row.canvasY,
    source: row.source,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type HrEmployeeDto = ReturnType<typeof hrEmployeeDto>;
