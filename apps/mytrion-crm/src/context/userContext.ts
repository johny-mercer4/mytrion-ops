/**
 * User context for the external Mytrion app. Identity now comes from a VERIFIED Zoho OAuth session
 * (see api/auth.ts + api/session.ts) — the worker signs in with their own Zoho account and the
 * backend mints a Bearer session carrying their verified zoho_user_id / profile / role / name.
 *
 * This replaces the old "advisory" model where identity rode in on spoofable URL params. The only
 * remaining non-session path is an explicit dev bypass (VITE_DEV_MOCK_AUTH=1) so the UI can be run
 * standalone without a backend.
 */
import type { MytrionId } from '../access/mytrions.config';
import type { SessionWorker } from '../api/session';

export interface UserContext {
  userId: string;
  profile: string;
  role: string;
  userName: string;
  /** True when the identity came from a verified Zoho session (false only for the dev mock). */
  trusted: boolean;
  /**
   * Server-resolved (DB-backed) access, present for verified sessions. When set, this is the
   * AUTHORITATIVE list the UI routes on; the static mytrions.config table is only a fallback for
   * the dev mock / legacy sessions that predate the access API.
   */
  accessibleMytrions?: MytrionId[];
  homeMytrion?: MytrionId | null;
  allDepartmentAccess?: boolean;
  /** Users this worker may "View as" (targeted impersonation grant) — drives the picker for non-admins. */
  viewAsTargets?: Array<{ zohoUserId: string; name: string | null }>;
}

/** Mirrors the old MOCK_USER so `vite dev` works standalone (admin, sees everything). */
const DEV_MOCK: UserContext = {
  userId: 'dev-user',
  profile: 'Administrator',
  role: 'CEO',
  userName: 'Dev User',
  trusted: false,
  allDepartmentAccess: true,
};

/** Map the verified session worker onto the UI's user context. */
export function contextFromWorker(worker: SessionWorker): UserContext {
  const ctx: UserContext = {
    userId: worker.zohoUserId,
    profile: worker.profile ?? '',
    role: worker.role ?? '',
    userName: worker.userName ?? '',
    trusted: true,
  };
  if (worker.accessibleMytrions) ctx.accessibleMytrions = worker.accessibleMytrions;
  if (worker.homeMytrion !== undefined) ctx.homeMytrion = worker.homeMytrion;
  if (worker.allDepartmentAccess !== undefined) ctx.allDepartmentAccess = worker.allDepartmentAccess;
  if (worker.viewAsTargets) ctx.viewAsTargets = worker.viewAsTargets;
  return ctx;
}

/**
 * Dev-only bypass: run the UI without a Zoho login (and without a session token — transport then
 * falls back to the dev API key). Enabled only when VITE_DEV_MOCK_AUTH=1 in a dev build.
 */
export function devMockContext(): UserContext | null {
  return import.meta.env.DEV && import.meta.env.VITE_DEV_MOCK_AUTH === '1' ? { ...DEV_MOCK } : null;
}
