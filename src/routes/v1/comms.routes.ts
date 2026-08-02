/**
 * Native comms metadata (/v1/comms) — the ticket-type / escalation-reason catalog and the department
 * options, replacing the three arrays the Sales wizard hardcodes today.
 *
 * Read-only and internal-only. Deliberately NOT gated on one department: every Mytrion that can file
 * or work a ticket needs this list, and the rows carry no client or personal data. The routing config
 * they *do* carry (who a reason falls to, who manages a department) is stripped in the DTO layer.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { commsCatalogRepo } from '../../repos/commsCatalogRepo.js';
import { commsDepartmentRepo } from '../../repos/commsDepartmentRepo.js';
import { commsSettingsRepo } from '../../repos/commsSettingsRepo.js';
import {
  toDepartmentOptionDto,
  toEscalationReasonDto,
  toTicketTypeDto,
} from '../../modules/comms/dto.js';
import { requireInternal } from './helpers.js';

const catalogQuery = z.object({
  /** Restrict to the queues this department can file into. Omit for everything. */
  target_department: z.string().max(60).optional(),
  /**
   * Admin editing view: include deactivated rows (the seeded M-* Maintenance family).
   *
   * Explicit string enum, NOT `z.coerce.boolean()`. Coercion here is JavaScript truthiness on the raw
   * query string, so `include_inactive=false` and `include_inactive=0` both arrive as TRUE — a flag that
   * cannot be turned off by saying false is worse than no flag. Verified against the repo's own zod.
   */
  include_inactive: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

export async function commsRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  /**
   * Everything the create wizard needs in ONE request.
   *
   * One round trip rather than three because the wizard cannot render its first step until all of it
   * has arrived — three requests would only add two more chances for a partial, half-rendered picker.
   */
  app.get('/comms/catalog', guard, async (request) => {
    const ctx = requireInternal(request, 'Comms catalog');
    const q = catalogQuery.parse(request.query);
    // Deactivated rows are an admin concern; a normal caller asking for them just gets the picker.
    const includeInactive =
      q.include_inactive === true && (ctx.role === 'admin' || ctx.allDepartmentAccess);

    // Spread rather than `key: undefined` — `exactOptionalPropertyTypes` makes an explicit undefined a
    // type error, and it would also be a lie: absent means "use the default", not "no filter".
    const activeFilter = includeInactive ? { activeOnly: false as const } : {};

    const [ticketTypes, reasons, departments, settings] = await Promise.all([
      commsCatalogRepo.list(ctx, {
        kind: 'ticket',
        ...activeFilter,
        ...(q.target_department ? { targetDepartment: q.target_department } : {}),
      }),
      commsCatalogRepo.list(ctx, { kind: 'escalation_reason', ...activeFilter }),
      commsDepartmentRepo.list(ctx),
      commsSettingsRepo.getEffective(ctx),
    ]);

    return {
      ticketTypes: ticketTypes.map(toTicketTypeDto),
      escalationReasons: reasons.map(toEscalationReasonDto),
      departments: departments.map(toDepartmentOptionDto),
      // The UI shows "response due in Nh" before a ticket exists, so it needs the map, not a per-row
      // answer. Only the SLA maps are exposed — dm flags and timezone are not the client's business.
      sla: {
        resolutionHoursByPriority: settings.slaHoursByPriority,
        firstResponseHoursByPriority: settings.firstResponseHoursByPriority,
      },
    };
  });
}
