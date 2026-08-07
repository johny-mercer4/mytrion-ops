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
import { requireDepartment } from './helpers.js';

/**
 * READ access to the HR directory — requires the 'hr' department grant.
 *
 * This used to check only `audience === 'internal'`, which is not a gate at all: every signed-in
 * worker, a sales agent included, could read all 213 employee rows (names, emails, mobiles, joining
 * dates, reporting lines) and the whole org structure. `requireDepartment` handles the admin /
 * all-department / bypass paths identically to every other module, so HR now sits behind the same
 * boundary as Billing or CS instead of behind none.
 */
export function requireHrInternal(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'hr', 'HR directory');
}

/** Create / edit / delete / Zoho sync — Mytrion Admin (all-department) only. */
export function requireHrAdmin(request: FastifyRequest): TenantContext {
  const ctx = requireHrInternal(request);
  if (!ctx.allDepartmentAccess && !ctx.bypassRbac && ctx.role !== 'admin') {
    throw new RBACError('Mytrion Admin access required to change employees');
  }
  return ctx;
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
