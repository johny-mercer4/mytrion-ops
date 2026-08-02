/**
 * Gong call intelligence — Phase 2 scaffold.
 *
 * When `FF_GONG_ENABLED=1` and credentials are present, Call Hub merges Gong rows as a third
 * source. Until the REST client is wired, this returns an empty list (fail-closed, no fake data).
 */
import { env } from '../config/env.js';

/** Minimal shape Call Hub maps into its unified DTO (avoids circular imports). */
export interface GongCallRow {
  id: string;
  startedAt: string;
  durationSeconds: number | null;
  phone: string;
  direction: string;
  result: string;
  subject: string | null;
  recordingUrl: string | null;
  transcriptSnippet: string | null;
}

export function gongConfigured(): boolean {
  return Boolean(
    env.FF_GONG_ENABLED && env.GONG_ACCESS_KEY.trim() && env.GONG_ACCESS_KEY_SECRET.trim(),
  );
}

/**
 * Agent-scoped Gong calls for Call Hub. Empty until the live Gong API client lands.
 */
export async function listGongCallsForAgent(
  _callerZohoUserId: string,
  _opts: { from?: Date; to?: Date; limit?: number } = {},
): Promise<GongCallRow[]> {
  if (!gongConfigured()) return [];
  // TODO: Gong `/v2/calls` (or equivalent) filtered by user/phone + date window.
  return [];
}
