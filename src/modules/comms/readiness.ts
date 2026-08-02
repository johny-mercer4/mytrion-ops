import { AppError } from '../../lib/errors.js';
import { commsReadinessRepo, type CommsSchemaReadiness } from '../../repos/commsReadinessRepo.js';

const READINESS_TTL_MS = 30_000;
let cached: { value: CommsSchemaReadiness; at: number } | null = null;
let inflight: Promise<CommsSchemaReadiness> | null = null;

export async function getCommsSchemaReadiness(force = false): Promise<CommsSchemaReadiness> {
  if (!force && cached && Date.now() - cached.at < READINESS_TTL_MS) return cached.value;
  if (inflight) return inflight;
  inflight = commsReadinessRepo
    .check()
    .then((value) => {
      cached = { value, at: Date.now() };
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function requireCommsSchema(): Promise<void> {
  const readiness = await getCommsSchemaReadiness();
  if (readiness.ready) return;
  throw new AppError('Tickets are temporarily unavailable while communications is being upgraded.', {
    statusCode: 503,
    code: 'COMMS_SCHEMA_NOT_READY',
    expose: true,
    details: { missingTables: readiness.missing },
  });
}

export function clearCommsReadinessCache(): void {
  cached = null;
}
