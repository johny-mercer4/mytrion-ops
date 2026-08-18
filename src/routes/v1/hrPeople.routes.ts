/**
 * Mytrion HR — everything scoped to ONE person: avatar bytes, the Zoho-user lookup, and the overview
 * the "View as" picker opens.
 *
 * Split out of `hr.routes.ts` to keep both files inside the 600-line cap. The gates and the employee
 * DTO live in `hrAccess.ts` so the two route files cannot disagree about who may read or write.
 */
import type { FastifyInstance, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { deleteFile, presignFile, storeFile } from '../../modules/files/fileService.js';
import { hrStorageProvider } from '../../modules/files/storage/index.js';
import { buildHrPersonOverview } from '../../modules/hr/hrPersonOverview.js';
import { hrEmployeeRepo } from '../../repos/hrEmployeeRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { hrEmployeeDto as toDto, requireHrManage, requireHrRead } from './hrAccess.js';

/**
 * A client-resized avatar, as a data URL.
 *
 * The cap is on the ENCODED string, which is ~4/3 of the bytes it carries — 700KB of base64 is about a
 * 512KB image, comfortably above a 512px JPEG and comfortably below the 2MB Fastify body limit, so an
 * oversized picture is rejected by this schema with a clear message instead of by the server dropping
 * the connection. The strict prefix is what makes the decode below safe.
 */
const PHOTO_DATA_URL = z
  .string()
  .max(700_000)
  .regex(/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/i, 'Invalid image data URL');

const PHOTO_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Data URL → bytes.
 *
 * The mime is taken from the URL's own prefix (already constrained to three image types by the schema)
 * rather than sniffed, and the extension is looked up in a fixed map — so nothing a caller supplies ever
 * reaches the storage key or the stored content type verbatim.
 */
function decodePhotoDataUrl(dataUrl: string): { buffer: Buffer; mime: string; extension: string } {
  const comma = dataUrl.indexOf(',');
  const mime = dataUrl.slice(5, dataUrl.indexOf(';')).toLowerCase();
  const buffer = Buffer.from(dataUrl.slice(comma + 1), 'base64');
  if (buffer.length === 0) throw new ValidationError('The image data is empty');
  return { buffer, mime, extension: PHOTO_EXTENSIONS[mime] ?? 'jpg' };
}

/**
 * Best-effort removal of a replaced avatar.
 *
 * A failure here must not fail the request: the employee row already points at the new photo, so the
 * user's action succeeded and all that remains is an orphaned object. Surfacing a 500 would tell them
 * the upload failed when it did not.
 */
async function discardPhotoAsset(ctx: TenantContext, fileId: string | null): Promise<void> {
  if (!fileId) return;
  try {
    await deleteFile(ctx, fileId);
  } catch {
    // Orphan left behind; the row is authoritative.
  }
}

export async function hrPeopleRoutes(app: FastifyInstance): Promise<void> {
  const auth: RouteShorthandOptions = { onRequest: [app.authenticate] };

  /**
   * Zoho CRM user id → employee row.
   *
   * The "View as" picker only knows a Zoho SIGN-IN; the HR directory is keyed by its own employee id,
   * and `hr_employees.zoho_user_id` is the only bridge (resolved by matching work email — see the
   * schema note). Kept as its own lookup rather than a query param on the directory list so the two id
   * spaces never blur into one another.
   *
   * 404 means "this sign-in has no employee record", which is a normal state, not an error condition.
   */
  app.get<{ Params: { zohoUserId: string } }>(
    '/hr/employees/by-zoho-user/:zohoUserId',
    auth,
    async (request) => {
      const ctx = requireHrRead(request);
      const row = await hrEmployeeRepo.findByZohoUserId(ctx, request.params.zohoUserId);
      if (!row) throw new NotFoundError('No employee record is linked to that Zoho user');
      return toDto(row);
    },
  );

  /**
   * Everything the person panel shows, in one round trip.
   *
   * Gated on HR directory access, not on admin: the blocks it returns are the same ones an HR user can
   * already read one at a time. Attendance is the exception — it is team-scoped, so the builder decides
   * per viewer and returns `canView: false` instead of failing the whole panel.
   */
  app.get<{ Params: { id: string } }>('/hr/employees/:id/overview', auth, async (request) => {
    const ctx = requireHrRead(request);
    const query = z
      .object({
        year: z.coerce.number().int().min(2000).max(2100).optional(),
        weekOf: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .parse(request.query ?? {});

    const employee = await hrEmployeeRepo.getById(ctx, request.params.id);
    if (!employee) throw new NotFoundError('Employee not found');

    const overview = await buildHrPersonOverview(ctx, employee, {
      year: query.year ?? new Date().getUTCFullYear(),
      weekOf: query.weekOf,
    });

    return {
      employee: toDto(overview.employee),
      department: overview.department,
      manager: overview.manager,
      team: overview.team,
      attendance: overview.attendance,
      timeOff: {
        year: overview.timeOff.year,
        balances: overview.timeOff.balances,
        // `listMine` returns a VIEW (request + joined names); the panel only needs the request itself.
        requests: overview.timeOff.requests.map(({ request: row }) => ({
          id: row.id,
          leaveTypeName: row.leaveTypeName,
          fromDate: row.fromDate,
          toDate: row.toDate,
          requestedDays: Number(row.requestedDays),
          status: row.status,
          reason: row.reason,
          submittedAt: row.submittedAt.toISOString(),
        })),
      },
    };
  });

  /**
   * Upload / replace an employee's avatar.
   *
   * A client-resized data URL rather than multipart, matching `/auth/me/avatar` and reusing the same
   * `resizeImageToDataUrl` helper in the CRM. The bytes then go through the ordinary file pipeline, so
   * they land wherever `FILE_STORAGE_PROVIDER` points (Dropbox today) and the provider is recorded on
   * the `file_assets` row — a later flip of that env cannot strand an avatar already written.
   */
  app.post<{ Params: { id: string } }>('/hr/employees/:id/photo', auth, async (request) => {
    const ctx = requireHrManage(request);
    const body = z.object({ dataUrl: PHOTO_DATA_URL }).parse(request.body ?? {});
    const employee = await hrEmployeeRepo.getById(ctx, request.params.id);
    if (!employee) throw new NotFoundError('Employee not found');

    const parsed = decodePhotoDataUrl(body.dataUrl);
    const previousFileId = employee.photoFileId;
    const stored = await storeFile(ctx, {
      name: `employee-${employee.id}.${parsed.extension}`,
      mime: parsed.mime,
      buffer: parsed.buffer,
      kind: 'upload',
      createdBy: 'hr.employee.photo',
      /**
       * HR's OWN Dropbox root, not the general file pipeline's. Employee headshots used to fall
       * through to `fileStorageProvider()` and land in `/comms` beside chat attachments; the folder
       * a photo lives in is part of how HR data stays separable.
       */
      storageProvider: hrStorageProvider(),
      /**
       * Tagged 'hr' so the asset inherits the same department boundary as the directory it belongs to:
       * a headshot must not become readable through the generic `/v1/files` list by a worker with no HR
       * grant. The read path (`/photo-link`) is gated on the HR department too, so the two agree.
       */
      department: 'hr',
    });
    const row = await hrEmployeeRepo.setPhotoFileId(ctx, employee.id, stored.fileId);
    if (!row) throw new NotFoundError('Employee not found');
    // Only once the row points at the NEW file: a delete-then-store order would leave the employee with
    // a dangling id if the upload failed, which renders as a permanently broken avatar.
    await discardPhotoAsset(ctx, previousFileId);

    await auditFromContext(ctx, {
      action: 'hr.employee.photo.update',
      status: 'ok',
      resourceType: 'hr_employee',
      resourceId: row.id,
      detail: { fileId: stored.fileId, sizeBytes: stored.sizeBytes, replaced: previousFileId != null },
    });
    return toDto(row);
  });

  /** Remove the avatar and the stored object behind it. Idempotent: no photo is not an error. */
  app.delete<{ Params: { id: string } }>('/hr/employees/:id/photo', auth, async (request) => {
    const ctx = requireHrManage(request);
    const employee = await hrEmployeeRepo.getById(ctx, request.params.id);
    if (!employee) throw new NotFoundError('Employee not found');
    if (!employee.photoFileId) return toDto(employee);

    const row = await hrEmployeeRepo.setPhotoFileId(ctx, employee.id, null);
    if (!row) throw new NotFoundError('Employee not found');
    await discardPhotoAsset(ctx, employee.photoFileId);
    await auditFromContext(ctx, {
      action: 'hr.employee.photo.clear',
      status: 'ok',
      resourceType: 'hr_employee',
      resourceId: row.id,
      detail: { fileId: employee.photoFileId },
    });
    return toDto(row);
  });

  /**
   * A time-limited URL for one employee's avatar — readable by anyone with HR directory access.
   *
   * Resolved per employee rather than embedded in the list, for the same reason comms attachments are:
   * a Dropbox link is a network round trip that Dropbox expires after ~4h, so pre-generating one per row
   * would make the 213-person directory 213 requests slower AND hand out links that die mid-session.
   *
   * The caller never names a file. The id comes off the employee row, so a file id alone can never be
   * turned into bytes here.
   */
  /**
   * The SAME link, for the handful of employees a page is actually rendering.
   *
   * Deliberately not "presign the whole directory" — the single-employee route above explains why
   * that is wrong, and this does not change it. What it removes is the browser making one HTTP
   * request per face: a team panel with twenty members cost twenty round trips through our API,
   * each of which then made its own Dropbox call. The client asks once for what is on screen.
   *
   * A per-employee failure yields no entry rather than failing the batch — one unreadable photo
   * must not blank the other nineteen. Ids the caller cannot see resolve to nothing, so this is not
   * a way to enumerate employees either.
   */
  app.post('/hr/employees/photo-links', auth, async (request) => {
    const ctx = requireHrRead(request);
    const { employeeIds } = z
      .object({ employeeIds: z.array(z.string().min(1)).min(1).max(100) })
      .parse(request.body ?? {});

    const unique = [...new Set(employeeIds)];
    const rows = await Promise.all(unique.map((id) => hrEmployeeRepo.getById(ctx, id)));
    const withPhotos = rows.filter(
      (r): r is NonNullable<typeof r> & { photoFileId: string } => Boolean(r?.photoFileId),
    );

    const resolved = await Promise.all(
      withPhotos.map(async (employee) => {
        try {
          const link = await presignFile(ctx, employee.photoFileId);
          return [employee.id, { url: link.url, expiresAt: link.expiresAt }] as const;
        } catch {
          return null;
        }
      }),
    );

    return { links: Object.fromEntries(resolved.filter(Boolean) as Array<readonly [string, unknown]>) };
  });

  app.get<{ Params: { id: string } }>('/hr/employees/:id/photo-link', auth, async (request) => {
    const ctx = requireHrRead(request);
    const employee = await hrEmployeeRepo.getById(ctx, request.params.id);
    if (!employee) throw new NotFoundError('Employee not found');
    if (!employee.photoFileId) throw new NotFoundError('This employee has no photo');
    const link = await presignFile(ctx, employee.photoFileId);
    return { url: link.url, expiresAt: link.expiresAt };
  });

}
