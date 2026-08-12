/**
 * The single authority for "which Mytrions may this worker use" — combines the per-profile default
 * (mytrion_profile_defaults), per-role default (mytrion_role_defaults), and per-user override
 * (worker_mytrion_access) into a final {accessibleMytrions, homeMytrion, allDepartmentAccess,
 * departments}. Injected into the verified session context (authService.contextFromClaims) so
 * backend RBAC (tool/agent/knowledge department gates) is DB-driven, and surfaced to the client
 * (/auth/me) so the UI stops guessing from profile strings.
 *
 * Layering: profile default if set, else legacy floor → role default (UNION grants / OR all-dept /
 * home overlay) → per-user override (replace / deny) → env-admin pin. Admin Profile/Role Defaults
 * are the control plane; the legacy floor only covers Zoho profiles not yet configured in Admin.
 *
 * Per-Mytrion modes (read|full): env-admin / allDept → all full; else user explicit mode wins;
 * else role mode; else full (profile grants are implicit full). Mode does not affect entry.
 *
 * Safety / no-lockout: only the ENV BREAK-GLASS list (ADMIN_USERS / BYPASS_USERS — named users in
 * server config, not editable from the app) is pinned to all-access and exempt from denies. An
 * ADMIN_PROFILE_MARKERS profile/role ("Administrator", "ceo") still grants all-access BY DEFAULT,
 * but that default is now overridable from Admin → User Management, because otherwise every
 * Administrator-profile user was silently unmanageable: their override was computed and then thrown
 * away, so the UI reported a saved grant the resolver ignored. The route layer refuses to save the
 * override that would remove the LAST all-access user, which is what actually prevents a lockout.
 * On any DB error the resolver fails OPEN to the legacy profile→department derivation.
 * Result is TTL-cached per (tenant, zohoUser) with coalesced in-flight fetches.
 */
import {
  deriveWorkerDepartments,
  isAdminUser,
  isBypassUser,
  resolveAllDepartmentAccess,
} from '../../lib/department.js';
import { logger } from '../../lib/logger.js';
import {
  DEFAULT_PROFILE_SEED,
  departmentsForMytrions,
  MYTRION_DEPARTMENT,
  MYTRION_IDS,
  profileKeyOf,
  roleKeyOf,
  type MytrionAccessMode,
  type MytrionAccessModes,
  type MytrionId,
} from '../../lib/mytrions.js';
import { mytrionProfileDefaultsRepo, type MytrionProfileDefaultDto } from '../../repos/mytrionProfileDefaultsRepo.js';
import { mytrionRoleDefaultsRepo, type MytrionRoleDefaultDto } from '../../repos/mytrionRoleDefaultsRepo.js';
import { workerMytrionAccessRepo, type WorkerMytrionAccessDto } from '../../repos/workerMytrionAccessRepo.js';
import {
  mytrionPermissionSetAssignmentsRepo,
  mytrionPermissionSetsRepo,
  type MytrionPermissionSetDto,
  type TabGrants,
} from '../../repos/mytrionPermissionSetsRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';

export interface ResolvedAccess {
  accessibleMytrions: MytrionId[];
  homeMytrion: MytrionId | null;
  allDepartmentAccess: boolean;
  departments: string[];
  /** Zoho user ids this worker may "View as" (targeted impersonation grant; per-user override). */
  viewAsUserIds: string[];
  /** Effective read|full per accessible Mytrion (omitted ids treated as full). */
  mytrionAccessModes: MytrionAccessModes;
  /**
   * Per-Mytrion visible tab whitelist, from permission sets. A Mytrion ABSENT is UNRESTRICTED —
   * every tab it has, including ones added after the grant was written.
   *
   * UI GATING ONLY. No backend route reads this, and it is deliberately NOT put on TenantContext:
   * doing so would invite a `requireTab` guard reading a field whose vocabulary lives in the client.
   * The security boundary stays at Mytrion + read/full.
   */
  mytrionTabGrants: TabGrants;
}

/** True when the worker may perform write actions in this Mytrion (admins always can). */
export function canWriteMytrion(
  access: Pick<ResolvedAccess, 'allDepartmentAccess' | 'accessibleMytrions' | 'mytrionAccessModes'>,
  id: MytrionId,
): boolean {
  if (access.allDepartmentAccess) return true;
  if (!access.accessibleMytrions.includes(id)) return false;
  return access.mytrionAccessModes[id] !== 'read';
}

function resolveModes(
  accessible: MytrionId[],
  allDept: boolean,
  roleModes: MytrionAccessModes,
  userModes: MytrionAccessModes,
  sets: readonly MytrionPermissionSetDto[] = [],
  /** Mytrions granted by the NON-set layers. A set's `read` may not lower any of these. */
  otherLayerGranted: ReadonlySet<MytrionId> = new Set(),
): MytrionAccessModes {
  if (allDept) {
    const out: MytrionAccessModes = {};
    for (const id of accessible) out[id] = 'full';
    return out;
  }
  /**
   * MOST PERMISSIVE WINS. Permission sets are additive, Salesforce-style: an explicit `full` from a
   * set beats a `read` on any other layer, including a per-user override.
   *
   * The alternative — per-user always wins — makes "assign Bob the Billing Full Ops set" a silent
   * no-op whenever Bob happens to carry an old override row, with no feedback anywhere. To restrict
   * someone you remove the set from them, which is how Salesforce works too.
   */
  const setFull = new Set<MytrionId>();
  const setRead = new Set<MytrionId>();
  for (const set of sets) {
    for (const id of set.allowedMytrions) {
      if (set.mytrionAccessModes[id] === 'full') setFull.add(id);
      else setRead.add(id);
    }
  }

  const out: MytrionAccessModes = {};
  for (const id of accessible) {
    if (setFull.has(id)) {
      out[id] = 'full';
      continue;
    }
    const fromUser = userModes[id];
    const fromRole = roleModes[id];
    /**
     * A set's `read` counts ONLY when the set is the sole source of the grant.
     *
     * Sets are additive: they may raise a mode, never lower one. Profile defaults have no mode
     * column, so a Mytrion they grant is implicitly FULL — and consulting `fromSet` unconditionally
     * meant assigning a read-only set to someone who already had that Mytrion REVOKED their write
     * access, which is the exact opposite of what an additive grant is allowed to do.
     *
     * It also removed a real hazard in the other direction: when the permission-set read fails soft,
     * a `read` that HAD been lowering something would spring back to `full`, so a transient database
     * problem escalated a user. With this rule the failure is strictly narrowing in every case —
     * either the set was the only source (and the Mytrion disappears entirely) or it was never
     * setting the mode at all.
     */
    const fromSet: MytrionAccessMode | undefined =
      setRead.has(id) && !otherLayerGranted.has(id) ? 'read' : undefined;
    const mode: MytrionAccessMode = fromUser ?? fromRole ?? fromSet ?? 'full';
    out[id] = mode;
  }
  return out;
}

/**
 * Union the tab scopes for each granted Mytrion.
 *
 * If ANY contributing layer granted the Mytrion WITHOUT a tab scope, the result is unscoped and the
 * key is omitted entirely. The three legacy layers are always unscoped — they have no tab column —
 * so a Mytrion also granted by a profile default is unscoped no matter what a set says.
 *
 * That is the honest consequence of additivity and it WILL surprise people ("I scoped them to Ledger
 * and they still see everything"). It is not hidden: the admin effective-access view names the layer
 * that defeated the scope and offers to narrow it. The alternative — any scoped source becomes a
 * ceiling — reintroduces the non-expressible "everything except X" trap that `enforceableAllDept`
 * already documents a workaround for.
 */
function resolveTabGrants(
  accessible: MytrionId[],
  legacyGranted: readonly MytrionId[],
  sets: readonly MytrionPermissionSetDto[],
): TabGrants {
  const out: TabGrants = {};
  const unscoped = new Set<MytrionId>(legacyGranted);
  const scoped = new Map<MytrionId, Set<string>>();

  for (const set of sets) {
    for (const id of set.allowedMytrions) {
      const tabs = set.tabGrants[id];
      if (tabs === undefined) {
        unscoped.add(id);
        continue;
      }
      const bucket = scoped.get(id) ?? new Set<string>();
      for (const key of tabs) bucket.add(key);
      scoped.set(id, bucket);
    }
  }

  for (const id of accessible) {
    if (unscoped.has(id)) continue;
    const bucket = scoped.get(id);
    if (bucket) out[id] = [...bucket];
  }
  return out;
}

export interface ResolveWorkerAccessInput {
  tenantId: string;
  zohoUserId: string;
  profileName?: string | null;
  zohoRole?: string | null;
  userName?: string | null;
}

/**
 * Short on purpose. Admin saves DO invalidate this cache directly, but that only covers the process
 * that handled the save — any other worker/instance keeps serving its own copy until expiry, which
 * is one of the ways an access edit appeared not to apply. 10s keeps the read cheap while bounding
 * how long a stale grant can survive anywhere in the fleet.
 */
const TTL_MS = 10_000;
/** A degraded (DB-error fallback) result is cached only briefly so recovery self-corrects fast. */
const DEGRADED_TTL_MS = 5_000;

interface CacheEntry {
  value: ResolvedAccess;
  expires: number;
}
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ResolvedAccess>>();
/**
 * Last CONFIDENTLY-resolved access per identity (no expiry). On a DB error we serve this instead of
 * the profile-substring fallback, so a DB-configured admin / a per-user override survives a transient
 * blip rather than being demoted to the legacy floor for the TTL.
 */
const lastGood = new Map<string, ResolvedAccess>();

interface ComputeResult {
  value: ResolvedAccess;
  /** true when the value is a DB-error fallback (not a confident resolution). */
  degraded: boolean;
  /** Provenance, only when `opts.trace` was requested. Never allocated on the hot path. */
  trace?: AccessTrace;
}

/** Which layer granted a thing. Ordered the way `combineAccess` applies them. */
export type AccessLayer =
  | 'legacy'
  | 'profile'
  | 'role'
  | 'marker_admin'
  | 'override'
  | 'permission_set'
  | 'break_glass';

export interface AccessTraceEntry {
  mytrion: MytrionId;
  /** Every layer that granted it, in application order. */
  grantedBy: { layer: AccessLayer; label: string }[];
  mode: MytrionAccessMode;
  modeFrom: { layer: AccessLayer; label: string };
  tabs: {
    scoped: boolean;
    keys: string[];
    /**
     * Set when a scope was DEFEATED — some layer granted this Mytrion without a tab list, so the
     * union is unscoped and every tab renders. This is the field the whole trace exists for: it is
     * the one behaviour that looks like a bug and is not.
     */
    unscopedBy?: { layer: AccessLayer; label: string };
  };
}

/**
 * Why a worker can reach what they can reach.
 *
 * Computed BY `combineAccess` itself rather than by a second explain function, deliberately. A
 * parallel implementation would drift from the resolver — which is precisely the failure the
 * LAST_ADMIN comment in mytrionAccess.routes.ts narrates for a different pair of divergent paths —
 * and an access explainer that disagrees with the gate is worse than none.
 *
 * It is plain data, so `combineAccess` stays pure and the hot path (no `opts`) allocates nothing.
 */
export interface AccessTrace {
  mytrions: AccessTraceEntry[];
  denied: MytrionId[];
  /** Names of the assigned sets that took the whole layer, if any. Empty when purely additive. */
  overriddenBy: string[];
  /** `enforceableAllDept` fired: an all-access grant was downgraded because a deny list exists. */
  allDeptDowngraded: boolean;
}

/**
 * Key on the FULL resolved identity (not just tenant+user): a worker's profile/role is stable in
 * prod, but keying on it means a profile change refreshes access immediately instead of serving a
 * stale grant for the TTL. (Also keeps tests that reuse a userId across profiles from colliding.)
 */
function cacheKey(input: ResolveWorkerAccessInput): string {
  return JSON.stringify([
    input.tenantId,
    input.zohoUserId,
    input.profileName ?? '',
    input.zohoRole ?? '',
    input.userName ?? '',
  ]);
}

/** Minimal context for the resolver's own config reads (the repos use only ctx.tenantId). */
function internalCtx(tenantId: string): TenantContext {
  return {
    tenantId,
    userId: 'system:access-resolver',
    audience: 'internal',
    role: 'admin',
    scopes: [],
    departments: [],
    allDepartmentAccess: false,
    requestId: 'access-resolver',
  };
}

function subtract(ids: MytrionId[], denied: MytrionId[]): MytrionId[] {
  if (denied.length === 0) return ids;
  const deny = new Set(denied);
  return ids.filter((id) => !deny.has(id));
}

/**
 * The active sets a worker actually holds.
 *
 * There are no foreign keys (house rule), so an assignment can outlive its set and an inactive set
 * can still have live assignments. Both are silently skipped rather than treated as an error — an
 * orphan must never be able to fail a login.
 */
function filterAssignedSets(
  allSets: readonly MytrionPermissionSetDto[],
  assignments: readonly { permissionSetId: string }[],
): MytrionPermissionSetDto[] {
  if (assignments.length === 0) return [];
  const held = new Set(assignments.map((a) => a.permissionSetId));
  return allSets.filter((s) => held.has(s.id) && s.active);
}

/**
 * Where an override-scoped worker lands.
 *
 * The lower layers stopped granting, so a home they set may now name a workspace this worker cannot
 * enter — which routes them straight into a 403 on sign-in. Keep it only if the sets still grant it;
 * otherwise hand back null and let `pickHome` choose from what they can actually reach.
 */
function pickOverrideHome(
  home: MytrionId | null,
  sets: readonly MytrionPermissionSetDto[],
): MytrionId | null {
  if (home === null) return null;
  return sets.some((set) => set.allowedMytrions.includes(home)) ? home : null;
}

function unionMytrions(a: MytrionId[], b: MytrionId[]): MytrionId[] {
  const out: MytrionId[] = [];
  const seen = new Set<MytrionId>();
  for (const id of [...a, ...b]) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Home = the configured home if it's still accessible, else the sole accessible Mytrion, else none. */
function pickHome(home: MytrionId | null, accessible: MytrionId[]): MytrionId | null {
  if (home && accessible.includes(home)) return home;
  if (accessible.length === 1) return accessible[0] ?? null;
  return null;
}

/**
 * Pure (no I/O) combine of profile default + role default + per-user override into final access.
 * Factored out so a bulk caller (the admin listing endpoint) can fetch tables ONCE and combine
 * in-memory for every user — see resolveBatch below.
 */
function combineAccess(
  input: ResolveWorkerAccessInput,
  pd: MytrionProfileDefaultDto | undefined,
  rd: MytrionRoleDefaultDto | undefined,
  ov: WorkerMytrionAccessDto | undefined,
  /** ALREADY filtered to this worker's active assignments — keeps this function pure. */
  sets: readonly MytrionPermissionSetDto[] = [],
  /** Provenance is opt-in: the per-request path passes nothing and allocates nothing. */
  opts?: { trace?: boolean },
): ComputeResult {
  // Marker admin = all-access by DEFAULT (a baseline the DB may lower).
  const markerAdmin = resolveAllDepartmentAccess({
    profile: input.profileName ?? null,
    role: input.zohoRole ?? null,
    userName: input.userName ?? null,
  });
  // Break-glass = named in server env. Immovable, because it is the recovery path if an admin
  // mis-configures themselves out of the app; it cannot be edited from inside the app.
  const breakGlass = isAdminUser(input.userName ?? null) || isBypassUser(input.userName ?? null);
  const havePd = Boolean(pd && pd.active);
  const haveRd = Boolean(rd && rd.active);
  const haveOv = Boolean(ov && ov.active);

  // UNMANAGED non-admin (no profile / role default AND no override) → legacy profile-derived
  // access so rollout stays non-breaking until an admin configures something.
  // A set counts as being managed: assigning one to an otherwise-unconfigured worker has to grant
  // something, or the whole feature is invisible for exactly the people it is easiest to onboard.
  if (!markerAdmin && !havePd && !haveRd && !haveOv && sets.length === 0) {
    return { value: legacyAccess(input, false), degraded: false };
  }

  // Step 1 — base grant.
  // Profile default (Admin → Profile Defaults) wins as the starting set when present.
  // Without a profile row, keep the legacy profile/role substring floor — Role Defaults and
  // per-user overrides layer on top. Role Defaults must not wipe unconfigured profiles to []
  // (that locked Sales users out of the app when any role default existed).
  let allowed: MytrionId[] = [];
  let home: MytrionId | null = null;
  let allDept = false;
  if (havePd && pd) {
    allowed = pd.allowedMytrions;
    home = pd.homeMytrion;
    allDept = pd.allDepartmentAccess;
  } else {
    const floor = legacyAccess(input, false);
    allowed = floor.accessibleMytrions;
    home = floor.homeMytrion;
    allDept = floor.allDepartmentAccess;
  }

  // Step 2 — role default overlays grants (UNION) and can raise all-dept / set home.
  // Particular Mytrion on a role = full access to that Mytrion (department 1:1 via mapping below).
  if (haveRd && rd) {
    if (rd.allDepartmentAccess) allDept = true;
    else allowed = unionMytrions(allowed, rd.allowedMytrions);
    if (rd.homeMytrion != null) home = rd.homeMytrion;
  }

  // Step 2.5 — MARKER FLOOR: a profile/role default must not silently strip an Administrator; only
  // the explicit per-user override in Step 3 may lower them. Without this, adding any profile-default
  // row for "Administrator" would quietly demote every admin in the org.
  if (markerAdmin) allDept = true;

  // Step 3 — per-user override (replace allowed / subtract denied / override home + all-access).
  let denied: MytrionId[] = [];
  let viewAsUserIds: string[] = [];
  let userModes: MytrionAccessModes = {};
  if (haveOv && ov) {
    if (ov.allowedMytrions != null) allowed = ov.allowedMytrions;
    denied = ov.deniedMytrions;
    if (ov.allDepartmentAccess != null) allDept = ov.allDepartmentAccess;
    if (ov.homeMytrion != null) home = ov.homeMytrion;
    viewAsUserIds = ov.viewAsUserIds;
    userModes = ov.mytrionAccessModes ?? {};
  }

  /**
   * Step 3.5 — PERMISSION SETS. Additive, per-user, Salesforce semantics.
   *
   * AFTER the override's `allowedMytrions` REPLACE, not before. A set is assigned to a person, so it
   * is exactly as specific as an override; folding it in earlier would mean "assign Billing Read
   * Only to Bob" silently does nothing whenever Bob has any override row at all — the same class of
   * bug this file's header already records for a grant that was computed and then thrown away.
   *
   * BEFORE the deny subtraction in Step 5, so an admin keeps a surgical way to remove one Mytrion
   * from someone who holds it through a set.
   */
  /**
   * Step 3.4 — OVERRIDE sets take the whole layer.
   *
   * `override` is the escape hatch from additivity. A union can only widen, so an additive set that
   * scopes Billing to Ledger is defeated the moment any lower layer grants Billing unscoped — right
   * for "a bit more access", useless for "EXACTLY this". When any assigned set declares override,
   * the permission-set layer becomes authoritative and precedence reads
   *   1. permission sets   2. per-user override   3. profile / role defaults
   *
   * The two exemptions are deliberate. Break-glass (env-named) users are untouched, because that is
   * the recovery path if an admin scopes themselves out of the app — it is applied after this, in
   * Step 4. And denies still subtract last in Step 5, so an override set can never re-grant
   * something an admin explicitly took away.
   */
  const overriding = sets.some((set) => set.override);
  if (overriding) {
    allowed = [];
    // The lower layers stop granting anything, so they also stop DEFEATING tab scopes — which is the
    // whole reason someone reaches for this switch.
    home = pickOverrideHome(home, sets);
    allDept = false;
    userModes = {};
  }

  const legacyGranted = overriding ? [] : [...allowed];

  /**
   * Provenance, recorded as we go rather than reconstructed afterwards.
   *
   * `grantedBy` is append-only and in application order, so the drawer can say "granted by Profile
   * Default 'Standard' AND by set 'Billing Full Ops'" — which is the question an admin actually has
   * when someone can reach something unexpected.
   */
  const grantedBy = new Map<MytrionId, { layer: AccessLayer; label: string }[]>();
  const note = (id: MytrionId, layer: AccessLayer, label: string): void => {
    if (opts?.trace !== true) return;
    grantedBy.set(id, [...(grantedBy.get(id) ?? []), { layer, label }]);
  };
  if (opts?.trace === true) {
    for (const id of legacyGranted) {
      note(
        id,
        havePd && pd ? 'profile' : haveRd && rd ? 'role' : 'legacy',
        havePd && pd ? `Profile Default "${pd.profileName}"` : haveRd && rd ? `Role Default "${rd.roleName}"` : 'Legacy profile match',
      );
    }
    if (haveOv && ov && ov.allowedMytrions != null) {
      for (const id of ov.allowedMytrions) note(id, 'override', 'Per-user override');
    }
    if (markerAdmin) for (const id of MYTRION_IDS) note(id, 'marker_admin', 'Administrator profile/role');
  }

  for (const set of sets) {
    allowed = unionMytrions(allowed, set.allowedMytrions);
    for (const id of set.allowedMytrions) note(id, 'permission_set', `Permission set "${set.name}"`);
  }

  // Step 4 — BREAK-GLASS FLOOR: only an env-named user's all-access is immovable by the DB. A
  // profile/role marker admin is NOT pinned here any more — see the header.
  if (breakGlass) allDept = true;

  // Step 5 — accessible set. Only break-glass users are EXEMPT from the deny-list.
  const fullSet = allDept ? [...MYTRION_IDS] : allowed;
  const accessible = breakGlass ? fullSet : subtract(fullSet, denied);

  // `allDepartmentAccess: true` is a FULL bypass in every backend gate, so it can't express
  // "everything except X". A non-env-admin all-access grant WITH denies is downgraded to an
  // explicit department grant so the deny actually enforces (not just hidden in the UI list).
  const enforceableAllDept = allDept && (breakGlass || denied.length === 0);
  // An overriding set owns the mode too — a role default's read/full is a lower layer and stops
  // applying with the grant it came from.
  const roleModes = overriding ? {} : haveRd && rd ? (rd.mytrionAccessModes ?? {}) : {};
  // Computed once and shared with the trace, so the drawer can never disagree with the gate.
  const modes = resolveModes(
    accessible,
    enforceableAllDept || breakGlass,
    roleModes,
    userModes,
    sets,
    new Set(legacyGranted),
  );
  /**
   * `allDept`, NOT `enforceableAllDept`.
   *
   * An all-department grant IS an unscoped grant of everything, so it defeats a set's tab scope the
   * same way a profile default does. `enforceableAllDept` is false whenever a deny list exists —
   * that downgrade exists so the Mytrion-level DENY actually enforces, and reusing it here meant an
   * admin who is denied one workspace suddenly had the rest of their nav scoped by any set they
   * happen to hold. Over-restriction rather than escalation, but wrong either way.
   */
  const tabGrants: TabGrants =
    allDept || breakGlass ? {} : resolveTabGrants(accessible, legacyGranted, sets);
  return {
    value: {
      accessibleMytrions: accessible,
      homeMytrion: pickHome(home, accessible),
      allDepartmentAccess: enforceableAllDept,
      departments: enforceableAllDept ? [] : departmentsForMytrions(accessible),
      viewAsUserIds,
      mytrionAccessModes: modes,
      // An all-access grant means all tabs. Leaving stale scoping on an admin is a support ticket.
      mytrionTabGrants: tabGrants,
    },
    degraded: false,
    ...(opts?.trace === true
      ? {
          trace: buildTrace({
            accessible,
            denied,
            allDeptDowngraded: allDept && !enforceableAllDept,
            grantedBy,
            modes,
            tabGrants,
            legacyGranted,
            sets,
            userModes,
            roleModes,
            roleLabel: haveRd && rd ? `Role Default "${rd.roleName}"` : null,
            profileLabel: havePd && pd ? `Profile Default "${pd.profileName}"` : null,
          }),
        }
      : {}),
  };
}

/**
 * Turn the recorded layers into the drawer's shape.
 *
 * The only genuinely interesting output is `unscopedBy`: it names the layer whose UNSCOPED grant
 * defeated a set's tab scope. Without it, "I scoped them to Ledger and they still see everything"
 * is an unanswerable support question — the admin has no way to see that a profile default is the
 * reason, because profile defaults have no tab column to look at.
 */
function buildTrace(input: {
  accessible: MytrionId[];
  denied: MytrionId[];
  allDeptDowngraded: boolean;
  grantedBy: Map<MytrionId, { layer: AccessLayer; label: string }[]>;
  modes: MytrionAccessModes;
  tabGrants: TabGrants;
  legacyGranted: readonly MytrionId[];
  sets: readonly MytrionPermissionSetDto[];
  userModes: MytrionAccessModes;
  roleModes: MytrionAccessModes;
  roleLabel: string | null;
  profileLabel: string | null;
}): AccessTrace {
  const legacySet = new Set(input.legacyGranted);
  return {
    denied: input.denied,
    allDeptDowngraded: input.allDeptDowngraded,
    overriddenBy: input.sets.filter((set) => set.override).map((set) => set.name),
    mytrions: input.accessible.map((id) => {
      const mode = input.modes[id] ?? 'full';

      // Which layer decided the MODE — mirroring resolveModes' own precedence exactly.
      const setFull = input.sets.find((s) => s.allowedMytrions.includes(id) && s.mytrionAccessModes[id] === 'full');
      let modeFrom: { layer: AccessLayer; label: string };
      if (setFull) modeFrom = { layer: 'permission_set', label: `Permission set "${setFull.name}"` };
      else if (input.userModes[id] !== undefined) modeFrom = { layer: 'override', label: 'Per-user override' };
      else if (input.roleModes[id] !== undefined) modeFrom = { layer: 'role', label: input.roleLabel ?? 'Role default' };
      else {
        // Mirrors resolveModes exactly: a set's `read` only decides the mode when the set is the
        // SOLE source. If another layer granted this Mytrion the mode is the implicit full, and
        // saying "mode from permission set X" would be a lie the admin then acts on.
        const setRead = legacySet.has(id)
          ? undefined
          : input.sets.find((s) => s.allowedMytrions.includes(id));
        modeFrom = setRead
          ? { layer: 'permission_set', label: `Permission set "${setRead.name}"` }
          : { layer: 'legacy', label: 'Default (full)' };
      }

      const keys = input.tabGrants[id];
      const scoped = keys !== undefined;
      // A set that scoped this Mytrion, but only matters when the scope did NOT survive.
      const scopingSet = input.sets.find((s) => s.tabGrants[id] !== undefined);
      let unscopedBy: { layer: AccessLayer; label: string } | undefined;
      if (!scoped && scopingSet) {
        if (legacySet.has(id)) {
          unscopedBy = input.profileLabel
            ? { layer: 'profile', label: input.profileLabel }
            : input.roleLabel
              ? { layer: 'role', label: input.roleLabel }
              : { layer: 'legacy', label: 'Legacy profile match' };
        } else {
          const openSet = input.sets.find((s) => s.allowedMytrions.includes(id) && s.tabGrants[id] === undefined);
          if (openSet) unscopedBy = { layer: 'permission_set', label: `Permission set "${openSet.name}"` };
          else unscopedBy = { layer: 'override', label: 'Per-user override' };
        }
      }

      return {
        mytrion: id,
        grantedBy: input.grantedBy.get(id) ?? [],
        mode,
        modeFrom,
        tabs: { scoped, keys: keys ?? [], ...(unscopedBy ? { unscopedBy } : {}) },
      };
    }),
  };
}

/**
 * Permission-set reads FAIL SOFT, on their own.
 *
 * Unlike the other three, these two queries are unconditional — there is no "only if the worker has
 * a profile name" shortcut — so letting them share the outer catch would mean an unreachable
 * permission-set table degrades EVERY user to `legacyAccess`, which grants far less and (by design)
 * never grants Customer Service. The realistic way to hit that is deploying this code before its
 * migration has run — a missing table on the release that adds one, a missing COLUMN on every
 * release that adds one after. Access would quietly collapse org-wide, and the logs would say
 * "resolve failed" rather than "the new schema is missing".
 *
 * THE TRADEOFF IS NOT SYMMETRIC, and `override` changed which way it leans. For an additive set,
 * resolving without it is strictly narrower and therefore safe. For an OVERRIDING set it is strictly
 * WIDER: the set is what suppresses the profile and role defaults, so losing it hands the holder
 * back everything those layers grant. Fail-soft is still the right call — the alternative collapses
 * every user's access for the length of a deploy window, against a narrow window in which a few
 * override holders are over-granted — but it is a deliberate fail-open, not a free one. The warning
 * below is the only signal it happened, so it must stay loud.
 */
function setsUnavailable(what: string): (err: unknown) => never[] {
  return (err) => {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), what },
      'permission set read failed — resolving without sets (grants from the other layers stand)',
    );
    return [];
  };
}

async function computeAccess(input: ResolveWorkerAccessInput): Promise<ComputeResult> {
  // Only used for the DB-error fallback below: with no tables readable we cannot honour an
  // override, so a marker admin falls back to all-access rather than to nothing.
  const envAdmin = resolveAllDepartmentAccess({
    profile: input.profileName ?? null,
    role: input.zohoRole ?? null,
    userName: input.userName ?? null,
  });
  const ctx = internalCtx(input.tenantId);

  try {
    /**
     * FIVE-way parallel, not sequential.
     *
     * The obvious shape — read this worker's assignments, then fetch those sets by id — doubles
     * cache-miss latency on the hot auth path, which runs per request behind a 10s TTL. `listActive`
     * is a small tenant-wide read of the same character as the profile-defaults list that
     * `resolveBatch` already does per call, so fetching all of them and filtering in memory is one
     * round trip instead of two.
     */
    const [pd, rd, ov, assignments, allSets] = await Promise.all([
      input.profileName != null
        ? mytrionProfileDefaultsRepo.findByKey(ctx, profileKeyOf(input.profileName))
        : Promise.resolve(undefined),
      input.zohoRole != null && input.zohoRole.trim() !== ''
        ? mytrionRoleDefaultsRepo.findByKey(ctx, roleKeyOf(input.zohoRole))
        : Promise.resolve(undefined),
      input.zohoUserId
        ? workerMytrionAccessRepo.findByZohoUserId(ctx, input.zohoUserId)
        : Promise.resolve(undefined),
      input.zohoUserId
        ? mytrionPermissionSetAssignmentsRepo.listByZohoUserId(ctx, input.zohoUserId).catch(setsUnavailable('assignments'))
        : Promise.resolve([]),
      mytrionPermissionSetsRepo.listActive(ctx).catch(setsUnavailable('sets')),
    ]);
    return combineAccess(input, pd, rd, ov, filterAssignedSets(allSets, assignments));
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), zohoUserId: input.zohoUserId },
      'mytrion access resolve failed — serving last-known-good / legacy fallback',
    );
    return { value: legacyAccess(input, envAdmin), degraded: true };
  }
}

/**
 * Fail-open fallback: env-admin → all; else profile/role substring → departments → Mytrions.
 * Customer Service Mytrion is NEVER granted here — Admin Profile/Role Defaults / per-user only.
 */
function legacyAccess(input: ResolveWorkerAccessInput, envAdmin: boolean): ResolvedAccess {
  if (envAdmin) {
    return {
      accessibleMytrions: [...MYTRION_IDS],
      homeMytrion: null,
      allDepartmentAccess: true,
      departments: [],
      viewAsUserIds: [],
      mytrionAccessModes: resolveModes([...MYTRION_IDS], true, {}, {}),
      mytrionTabGrants: {},
    };
  }
  const departments = deriveWorkerDepartments(input.profileName ?? null, input.zohoRole ?? null).filter(
    (d) => d !== 'customer-service',
  );
  const deptSet = new Set(departments);
  const accessible = MYTRION_IDS.filter(
    (id) => id !== 'customer-service' && deptSet.has(MYTRION_DEPARTMENT[id]),
  );
  return {
    accessibleMytrions: accessible,
    homeMytrion: accessible.length === 1 ? (accessible[0] ?? null) : null,
    allDepartmentAccess: false,
    departments,
    viewAsUserIds: [],
    // The legacy fallback predates permission sets and cannot read them (it is the no-DB path).
    mytrionTabGrants: {},
    mytrionAccessModes: resolveModes(accessible, false, {}, {}),
  };
}

export const mytrionAccessService = {
  /**
   * Resolve WITH provenance, for the admin "why can they see this?" drawer.
   *
   * Deliberately UNCACHED: it is an admin-initiated, one-user-at-a-time read, and serving a 10s-old
   * explanation for a grant someone just edited is exactly the confusion this exists to remove.
   */
  async explain(input: ResolveWorkerAccessInput): Promise<{ access: ResolvedAccess; trace: AccessTrace | null }> {
    const ctx = internalCtx(input.tenantId);
    try {
      const [pd, rd, ov, assignments, allSets] = await Promise.all([
        input.profileName != null
          ? mytrionProfileDefaultsRepo.findByKey(ctx, profileKeyOf(input.profileName))
          : Promise.resolve(undefined),
        input.zohoRole != null && input.zohoRole.trim() !== ''
          ? mytrionRoleDefaultsRepo.findByKey(ctx, roleKeyOf(input.zohoRole))
          : Promise.resolve(undefined),
        input.zohoUserId
          ? workerMytrionAccessRepo.findByZohoUserId(ctx, input.zohoUserId)
          : Promise.resolve(undefined),
        input.zohoUserId
          ? mytrionPermissionSetAssignmentsRepo.listByZohoUserId(ctx, input.zohoUserId).catch(setsUnavailable('assignments'))
          : Promise.resolve([]),
        mytrionPermissionSetsRepo.listActive(ctx).catch(setsUnavailable('sets')),
      ]);
      const result = combineAccess(input, pd, rd, ov, filterAssignedSets(allSets, assignments), {
        trace: true,
      });
      return { access: result.value, trace: result.trace ?? null };
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), zohoUserId: input.zohoUserId },
        'access explain failed',
      );
      return { access: legacyAccess(input, false), trace: null };
    }
  },

  /** Resolve (TTL-cached) a worker's effective Mytrion access. Never throws — degrades to legacy. */
  async resolveWorkerAccess(input: ResolveWorkerAccessInput): Promise<ResolvedAccess> {
    const key = cacheKey(input);
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const pending = inflight.get(key);
    if (pending) return pending;
    const p = computeAccess(input)
      .then(({ value, degraded }) => {
        if (!degraded) {
          lastGood.set(key, value);
          cache.set(key, { value, expires: Date.now() + TTL_MS });
          return value;
        }
        // DB error: prefer the last confidently-resolved grant (keeps a DB-configured admin / an
        // override intact through a blip); else serve the legacy fallback but only briefly so the
        // next request re-attempts the DB and self-corrects on recovery.
        const served = lastGood.get(key) ?? value;
        cache.set(key, { value: served, expires: Date.now() + DEGRADED_TTL_MS });
        return served;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, p);
    return p;
  },

  /**
   * Resolve MANY workers' access at once from bulk queries (profile + role defaults + overrides) —
   * used by the admin listing endpoint so listing N users costs O(1) DB round trips instead of the
   * per-user resolver's 3N. Also warms the per-user TTL cache.
   */
  async resolveBatch(
    tenantId: string,
    users: ResolveWorkerAccessInput[],
    prefetchedOverrides?: WorkerMytrionAccessDto[],
  ): Promise<Map<string, ResolvedAccess>> {
    const ctx = internalCtx(tenantId);
    // Five bulk reads for N users, not 5N. The whole point of this path.
    const [profileDefaults, roleDefaults, overrides, assignments, allSets] = await Promise.all([
      mytrionProfileDefaultsRepo.list(ctx),
      mytrionRoleDefaultsRepo.list(ctx),
      prefetchedOverrides ?? workerMytrionAccessRepo.list(ctx),
      mytrionPermissionSetAssignmentsRepo.listAllActive(ctx).catch(setsUnavailable('assignments')),
      mytrionPermissionSetsRepo.listActive(ctx).catch(setsUnavailable('sets')),
    ]);
    const pdByKey = new Map(profileDefaults.map((p) => [p.profileKey, p]));
    const rdByKey = new Map(roleDefaults.map((r) => [r.roleKey, r]));
    const ovById = new Map(overrides.map((o) => [o.zohoUserId, o]));
    const assignmentsByUser = new Map<string, { permissionSetId: string }[]>();
    for (const a of assignments) {
      const list = assignmentsByUser.get(a.zohoUserId) ?? [];
      list.push(a);
      assignmentsByUser.set(a.zohoUserId, list);
    }

    const result = new Map<string, ResolvedAccess>();
    for (const input of users) {
      const pd = input.profileName != null ? pdByKey.get(profileKeyOf(input.profileName)) : undefined;
      const rd =
        input.zohoRole != null && input.zohoRole.trim() !== ''
          ? rdByKey.get(roleKeyOf(input.zohoRole))
          : undefined;
      const ov = ovById.get(input.zohoUserId);
      const sets = filterAssignedSets(allSets, assignmentsByUser.get(input.zohoUserId) ?? []);
      const { value, degraded } = combineAccess(input, pd, rd, ov, sets);
      if (!degraded) {
        const key = cacheKey(input);
        lastGood.set(key, value);
        cache.set(key, { value, expires: Date.now() + TTL_MS });
      }
      result.set(input.zohoUserId, value);
    }
    return result;
  },

  /**
   * Seed DEFAULT_PROFILE_SEED for a tenant (idempotent). Empty tenants get the full seed.
   * Already-seeded tenants only INSERT missing seed keys — existing admin edits are never
   * overwritten. Called at boot (modules/access/bootstrap.ts) and by GET /admin/mytrion-access/profiles.
   */
  async ensureProfileDefaultsSeeded(tenantId: string): Promise<MytrionProfileDefaultDto[]> {
    const ctx = internalCtx(tenantId);
    const existing = await mytrionProfileDefaultsRepo.list(ctx);
    const existingKeys = new Set(existing.map((row) => row.profileKey));
    let inserted = 0;
    for (const seed of DEFAULT_PROFILE_SEED) {
      const key = profileKeyOf(seed.profileName);
      if (existingKeys.has(key)) continue;
      await mytrionProfileDefaultsRepo.upsert(ctx, {
        profileName: seed.profileName,
        allowedMytrions: seed.allowedMytrions,
        homeMytrion: seed.homeMytrion,
        allDepartmentAccess: seed.allDepartmentAccess,
      });
      inserted += 1;
    }
    if (inserted > 0) {
      this.invalidateAll();
      logger.info({ tenantId, inserted }, 'mytrion access: backfilled missing profile defaults from seed');
    }
    // One-time product harden: strip leaked Standard → CS auto-grant on already-seeded tenants.
    await this.reconcileStandardNoCsGrant(tenantId);
    return mytrionProfileDefaultsRepo.list(ctx);
  },

  /**
   * Historical seed mapped Zoho profile "Standard" → CS Mytrion for every Standard user.
   * CS is Admin-controlled now — clear that default when it is still CS-only.
   */
  async reconcileStandardNoCsGrant(tenantId: string): Promise<void> {
    const ctx = internalCtx(tenantId);
    const standard = await mytrionProfileDefaultsRepo.findByKey(ctx, profileKeyOf('Standard'));
    if (!standard?.active) return;
    const onlyCs =
      standard.allowedMytrions.length === 1 && standard.allowedMytrions[0] === 'customer-service';
    if (!onlyCs) return;
    await mytrionProfileDefaultsRepo.upsert(ctx, {
      profileName: standard.profileName,
      allowedMytrions: [],
      homeMytrion: null,
      allDepartmentAccess: false,
      active: standard.active,
    });
    this.invalidateAll();
    logger.info({ tenantId }, 'mytrion access: cleared Standard → CS auto-grant (Admin-only CS)');
  },

  /** Drop a user's cached access across all identity variants (call after an override upsert). */
  invalidateUser(tenantId: string, zohoUserId: string): void {
    for (const map of [cache, lastGood]) {
      for (const key of map.keys()) {
        try {
          const parts = JSON.parse(key) as unknown[];
          if (parts[0] === tenantId && parts[1] === zohoUserId) map.delete(key);
        } catch {
          /* non-JSON key — ignore */
        }
      }
    }
  },

  /** Clear the whole cache (call after a profile/role-default change — it affects many users). */
  invalidateAll(): void {
    cache.clear();
    lastGood.clear();
  },
};
