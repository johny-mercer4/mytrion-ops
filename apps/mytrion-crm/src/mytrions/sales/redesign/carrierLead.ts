/**
 * Create Lead from a Carrier Lookup row — same payload as the self-service
 * CarrierSearchPanel → mytrioncreatelead Deluge.
 */
import { callTouchpoint } from '@/api/touchpoints';
import { resolveCreateLeadOutcome } from './createLeadOutcome';
import { invalidateDcCache } from './dcCache';
import type { CarrierSearchVM } from './live';

export interface CarrierLeadOutcome {
  ok: boolean;
  duplicate: boolean;
  leadId: string;
  message: string;
}

function splitOwnerName(owner: string): { firstName: string; lastName: string } {
  const parts = owner.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: 'Unknown' };
  if (parts.length === 1) return { firstName: '', lastName: parts[0] ?? 'Unknown' };
  const lastName = parts.pop() ?? 'Unknown';
  return { firstName: parts.join(' '), lastName };
}

/** Build the Deluge createPayload for a broker-snapshot carrier row. */
export function carrierToCreatePayload(c: CarrierSearchVM): Record<string, string> {
  const owner = c.owner === '—' ? '' : c.owner;
  const { firstName, lastName } = splitOwnerName(owner || 'Unknown');
  const phone = (c.phone === '—' ? '' : c.phone).replace(/\D/g, '').slice(0, 10);
  const payload: Record<string, string> = {
    firstName,
    lastName,
    companyName: owner || 'Unknown',
    phone,
  };
  if (c.email && c.email !== '—') payload.email = c.email;
  if (c.dot && c.dot !== '—') payload.dot = c.dot;
  if (c.address) payload.fullAddress = c.address;
  if (c.truckSize) payload.truckSize = c.truckSize;
  if (c.units && c.units !== '—') payload.powerUnits = c.units;
  if (c.addDate) payload.addDate = c.addDate.slice(0, 10);
  if (c.changeDate) payload.changeDate = c.changeDate.slice(0, 10);
  if (c.status && c.status !== 'unknown') payload.operatingStatus = c.status;
  return payload;
}

export async function createLeadFromCarrier(c: CarrierSearchVM): Promise<CarrierLeadOutcome> {
  const res = await callTouchpoint('leads.create', { createPayload: carrierToCreatePayload(c) });
  const outcome = resolveCreateLeadOutcome(res);
  // A freshly created lead should show up in the Data Center Leads list without a manual refresh.
  if (outcome.ok && !outcome.duplicate) invalidateDcCache('sales:leads');
  return outcome;
}
