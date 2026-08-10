import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getCommsRouting,
  listRoutingCandidates,
  patchDepartmentRouting,
  patchEscalationReason,
  patchPoolSeat,
  removePoolSeat,
  upsertPoolSeat,
  type AssignmentStrategy,
  type DepartmentRouting,
  type EscalationReasonRouting,
  type RoutingCandidate,
  type RoutingSnapshot,
} from '../../api/commsAdmin';
import { PersonPicker } from './PersonPicker';
import { adminToast } from './toast';
import s from './admin.module.css';
import e from './escalationRouting.module.css';
import { ConfirmDialog } from '@/ds';

/**
 * Escalation Routing — who an escalation goes to at each of the four levels.
 *
 * This screen is the only thing that makes escalations work at all. Every rung ships unset, and the server
 * treats unset as "refuse loudly" rather than as a wildcard, so an agent raising an escalation on an
 * unconfigured reason is told to come here. The readiness tiles are computed SERVER-SIDE for that reason:
 * the gaps shown here and the refusal the agent sees must not be able to disagree.
 *
 * Saves are per row and optimistic-free: each row awaits its own request and shows its own busy state, so
 * one slow save never blocks the rest of the screen and there is no second page-level spinner.
 */

const C_LEVEL = 'c-level';

/**
 * A pending seat deletion, raised by a row and confirmed at the PANEL ROOT.
 *
 * Never inside the row that owns the seat: `e.row` carries `backdrop-filter`, which per spec makes it a
 * containing block for `position: fixed` descendants *and* a stacking context. A ConfirmDialog mounted
 * in one is therefore sized to that single department row — a clipped sheet whose buttons sit outside
 * the row's box, no dimmed page, and the rows rendered after it painting on top. Every other
 * ConfirmDialog in the app (Deals, DataLoader, CarrierUsers) mounts at its page root for this reason.
 *
 * The copy travels with the request rather than being rebuilt here: the last-C-Level-seat warning and
 * the "Deactivate instead" hint are only knowable at the call site.
 */
type PendingRemoval = {
  /** Routing slug the seat sits on — `c-level` for the pool, whose removal reports differently. */
  department: string;
  zohoUserId: string;
  name: string;
  title: string;
  body: string;
};

/** The rung colours match the ladder legend, so a row and the legend never disagree about a level. */
const RUNGS: { level: number; label: string; tone: string; where: string }[] = [
  { level: 1, label: 'Requester', tone: 'var(--tone-slate)', where: 'whoever raises it' },
  {
    level: 2,
    label: 'Agent',
    tone: 'var(--tone-cyan)',
    where: "the target department's default assignee or roster; a reason-only raise uses the reason's fall-to user",
  },
  { level: 3, label: 'Dept. Manager', tone: 'var(--tone-violet)', where: 'set per department' },
  { level: 4, label: 'C-Level', tone: 'var(--tone-amber)', where: 'the C-Level pool' },
];

export function EscalationRouting() {
  const [snap, setSnap] = useState<RoutingSnapshot | null>(null);
  const [candidates, setCandidates] = useState<RoutingCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pendingRemove, setPendingRemove] = useState<PendingRemoval | null>(null);
  const [removing, setRemoving] = useState(false);

  // Every fetch that writes into state takes a ticket, and only the newest ticket may land. Rows save
  // independently (each has its own `busy`), so two saves in quick succession put two refreshes in
  // flight — and the slower one would otherwise install a snapshot taken before the newer save
  // committed, showing a row the admin just fixed as unrouted.
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    // Retry re-enters here with `loading` already false, and `snap` still null — without this the
    // screen falls through to "No routing configuration available." for the whole request.
    setLoading(true);
    setError('');
    try {
      // Together: the screen is unusable with only one of them, so a single await keeps it to one
      // loading state rather than two staggered ones.
      const [routing, people] = await Promise.all([
        getCommsRouting(),
        listRoutingCandidates({ limit: 500 }),
      ]);
      if (seq !== seqRef.current) return;
      setSnap(routing);
      setCandidates(people.candidates);
    } catch (err) {
      if (seq !== seqRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      // A superseded attempt must not clear the flag: the newer one is still running.
      if (seq === seqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Refresh from the server after every save rather than patching local state: `readiness` is derived
  // server-side, and a locally-patched copy would drift from the numbers the agents' refusals use.
  const refresh = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const routing = await getCommsRouting();
      if (seq !== seqRef.current) return;
      setSnap(routing);
    } catch (err) {
      adminToast.error('Saved, but the screen could not refresh', err instanceof Error ? err.message : undefined);
    }
  }, []);

  // Removal is a hard DELETE server-side, so it runs here rather than in the row: the dialog stays
  // mounted for the round trip (its button reads "Working…") and the row it belongs to is disabled
  // through `removing`, which is why the in-flight flag is lifted along with the pending seat.
  async function confirmRemove(): Promise<void> {
    const seat = pendingRemove;
    if (!seat) return;
    setRemoving(true);
    try {
      await removePoolSeat(seat.department, seat.zohoUserId);
      if (seat.department === C_LEVEL) {
        // Escalations already at level 4 keep the person their hop recorded — the chain snapshots its
        // assignee, so removing a seat never rewrites history.
        adminToast.success(
          `${seat.name} removed from C-Level`,
          'Escalations already with them are unchanged.',
        );
      } else {
        adminToast.success('Removed from the roster');
      }
      await refresh();
    } catch (err) {
      adminToast.error('Could not remove', err instanceof Error ? err.message : undefined);
    } finally {
      setRemoving(false);
      setPendingRemove(null);
    }
  }

  // `.panel` is what supplies this tab's padding, measure, flex column and gap — EVERY branch needs it,
  // or the tab renders flush against the sidebar while loading and then jumps when the data lands.
  if (loading) {
    return (
      <div className={s.panel}>
        <div aria-busy="true">
          <span className={s.srOnly} role="status">
            Loading escalation routing…
          </span>
          <div className={e.readiness}>
            <div className={s.skelCard} />
            <div className={s.skelCard} />
            <div className={s.skelCard} />
          </div>
          <div className={e.rows}>
            <div className={s.skelCard} />
            <div className={s.skelCard} />
            <div className={s.skelCard} />
            <div className={s.skelCard} />
          </div>
        </div>
      </div>
    );
  }

  if (error && !snap) {
    return (
      <div className={s.panel}>
        <div className={s.errorState} role="alert">
          <p className={s.errorText}>{error}</p>
          <div className={s.errorActions}>
            <button
              type="button"
              className={s.primaryBtn}
              disabled={loading}
              onClick={() => void load()}
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!snap)
    return (
      <div className={s.panel}>
        <div className={s.none}>No routing configuration available.</div>
      </div>
    );

  const reasons = [...snap.escalationReasons].sort((a, b) => a.sortOrder - b.sortOrder);
  const routedCount = reasons.filter((r) => r.active && r.routed).length;
  const activeReasons = reasons.filter((r) => r.active).length;
  // `c-level` is out of the denominator: level 4 is a POOL, so that row can never have a manager, and
  // counting it would leave the tile permanently one short next to an all-clear hint. The server's
  // `departmentsMissingManager` excludes it for the same reason — the fraction must agree with it.
  const escalationDepts = snap.departments.filter(
    (d) => d.acceptsEscalations && d.department !== C_LEVEL,
  );
  const withManager = escalationDepts.filter((d) => d.managerZohoUserId).length;
  const cLevelSeats = snap.cLevel.filter((p) => p.active);
  // Departments the org HAS but that nothing can be escalated to yet — the gap this screen exists to close.
  const unconfiguredHr = snap.hrDepartments.filter((d) => !d.configured);
  // A name that cannot produce a valid routing slug is unconfigurable until renamed, not merely unconfigured.
  const unroutableHr = unconfiguredHr.filter((d) => d.suggestedSlug === null);
  // Departments that take tickets but have nobody on the rota — those tickets land unassigned.
  const ticketDepts = snap.departments.filter(
    (d) => d.acceptsTickets && d.ticketAssignmentStrategy !== 'manual',
  );
  const staffed = ticketDepts.filter((d) => d.pool.some((p) => p.active));

  return (
    <div className={s.panel}>
      <div className={s.head}>
        <div>
          <div className={s.eyebrow}>Comms</div>
          <h2 className={s.h2}>Escalation Routing</h2>
          <p className={s.sub}>
            Who an escalation reaches at each of the four levels. Every rung ships unset, and the server
            refuses a raise on an unset rung rather than filing it into an empty inbox.
          </p>
        </div>
      </div>

      {error && (
        <p className={s.errorNote} role="alert">
          {error}
        </p>
      )}

      <div className={e.readiness}>
        <ReadyTile
          num={`${routedCount}/${activeReasons}`}
          label="Escalation reasons routed"
          hint={
            snap.readiness.unroutedReasons.length > 0
              ? `Unrouted: ${snap.readiness.unroutedReasons.join(', ')}`
              : 'Every active reason has a level-2 assignee.'
          }
          ok={snap.readiness.unroutedReasons.length === 0}
        />
        <ReadyTile
          num={`${withManager}/${escalationDepts.length}`}
          label="Departments with a manager"
          hint={
            snap.readiness.departmentsMissingManager.length > 0
              ? `Missing: ${snap.readiness.departmentsMissingManager.join(', ')}`
              : 'Level 3 resolves for every department that takes escalations.'
          }
          ok={snap.readiness.departmentsMissingManager.length === 0}
        />
        <ReadyTile
          num={`${staffed.length}/${ticketDepts.length}`}
          label="Ticket queues staffed"
          hint={
            staffed.length === ticketDepts.length
              ? 'Every auto-assigning queue has somebody on the rota.'
              : `No rota: ${ticketDepts
                  .filter((d) => !d.pool.some((p) => p.active))
                  .map((d) => d.label)
                  .join(', ')} — tickets there land unassigned.`
          }
          ok={staffed.length === ticketDepts.length}
        />
        <ReadyTile
          num={String(cLevelSeats.length)}
          label="C-Level members"
          hint={
            snap.readiness.cLevelConfigured
              ? cLevelSeats.map((p) => p.roleTitle ?? p.displayName ?? p.zohoUserId).join(' · ')
              : 'Level 4 is unreachable — the ladder stops at the department manager.'
          }
          ok={snap.readiness.cLevelConfigured}
        />
      </div>

      <div className={e.ladder}>
        {RUNGS.map((r, i) => (
          <span key={r.level} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            <span className={e.rung} style={{ ['--tone' as string]: r.tone }} title={r.where}>
              <span className={e.rungNum}>{r.level}</span>
              {r.label}
            </span>
            {i < RUNGS.length - 1 && <span className={e.rungArrow}>→</span>}
          </span>
        ))}
      </div>

      <section className={e.section}>
        <div className={e.sectionHead}>
          <h3 className={s.h2}>Level 2 — the fall-to user per reason</h3>
        </div>
        <p className={e.sectionSub}>
          An escalation opened <em>against a department</em> goes to that department&rsquo;s default assignee
          (or its roster) — set those below. This list is the fallback for a raise with no department in mind:
          the person a reason lands on by itself. Either way an unrouted request is refused rather than filed
          into an empty inbox.
        </p>
        <div className={e.rows}>
          {reasons.map((r) => (
            <ReasonRow key={r.code} reason={r} candidates={candidates} onSaved={refresh} />
          ))}
        </div>
      </section>

      <section className={e.section}>
        <div className={e.sectionHead}>
          <h3 className={s.h2}>Departments — manager, hand-off target and ticket rota</h3>
        </div>
        <p className={e.sectionSub}>
          The <strong>default assignee</strong> is level 2 for anything opened against this department, and
          also who receives a sideways hand-off into it. The <strong>manager</strong> is level 3, where an
          escalation rises from the agent level. Departments come from HR; escalations already in flight keep
          the assignee they were given.
        </p>
        <div className={e.rows}>
          {snap.departments
            .filter((d) => d.department !== C_LEVEL)
            .map((d) => (
              <DepartmentRow
                key={d.department}
                dept={d}
                candidates={candidates}
                onSaved={refresh}
                onRequestRemove={setPendingRemove}
                removing={removing && pendingRemove?.department === d.department}
              />
            ))}
        </div>
      </section>

      {unconfiguredHr.length > 0 && (
        <p className={s.noticeNote}>
          {unconfiguredHr.length} HR department{unconfiguredHr.length === 1 ? '' : 's'} have no routing row
          yet, so nothing can be escalated to them:{' '}
          {unconfiguredHr.map((d) => d.name).join(', ')}.
          {unroutableHr.length > 0 &&
            ` ${unroutableHr.map((d) => d.name).join(', ')} cannot be configured until renamed — a routing key needs to start with a letter.`}
        </p>
      )}

      <section className={e.section}>
        <div className={e.sectionHead}>
          <h3 className={s.h2}>Level 4 — the C-Level pool</h3>
        </div>
        <p className={e.sectionSub}>
          A pool and not a single field, because level 4 is the CEO <em>and</em> the COO — the escalating
          manager picks which. Give each seat a role title so &ldquo;Escalate to CEO&rdquo; is
          distinguishable from &ldquo;Escalate to COO&rdquo;.
        </p>
        <CLevelPool
          seats={snap.cLevel}
          candidates={candidates}
          onSaved={refresh}
          onRequestRemove={setPendingRemove}
          removing={removing && pendingRemove?.department === C_LEVEL}
        />
      </section>

      {/* Both removals share this one dialog, mounted on `.panel` — see PendingRemoval for why it may
          not live inside the row. `.panel` has no filter/transform of its own, so the backdrop's
          `position: fixed` still resolves against the viewport. */}
      {pendingRemove && (
        <ConfirmDialog
          open
          tone="danger"
          title={pendingRemove.title}
          body={pendingRemove.body}
          confirmLabel="Remove"
          confirming={removing}
          onConfirm={() => void confirmRemove()}
          onClose={() => {
            if (!removing) setPendingRemove(null);
          }}
        />
      )}
    </div>
  );
}

function ReadyTile({
  num,
  label,
  hint,
  ok,
}: {
  num: string;
  label: string;
  hint: string;
  ok: boolean;
}) {
  return (
    <div className={`${e.readyTile} ${ok ? e.readyTileOk : e.readyTileGap}`}>
      <span className={e.readyNum}>{num}</span>
      <span className={e.readyBody}>
        <span className={e.readyLabel}>{label}</span>
        <span className={e.readyHint}>{hint}</span>
      </span>
    </div>
  );
}

function ReasonRow({
  reason,
  candidates,
  onSaved,
}: {
  reason: EscalationReasonRouting;
  candidates: RoutingCandidate[];
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function save(assignee: string | null, who: string): Promise<void> {
    setBusy(true);
    try {
      await patchEscalationReason(reason.code, { defaultAssigneeZohoUserId: assignee });
      adminToast.success(
        assignee ? `${reason.label} → ${who}` : `${reason.label} is unrouted again`,
        assignee ? 'New escalations on this reason land with them.' : 'Escalations on it will be refused.',
      );
      await onSaved();
    } catch (err) {
      adminToast.error('Could not save', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${e.row} ${reason.routed ? '' : e.rowGap}`}>
      <div className={e.rowMain}>
        <span className={e.rowTitle}>
          <span className={e.rowCode}>{reason.code}</span>
          {reason.label}
          {!reason.active && <span className={s.pillNeutral}>inactive</span>}
        </span>
        <span className={e.rowMeta}>
          {reason.routed ? 'Routed' : 'Unrouted — escalations on this reason are refused'}
        </span>
      </div>
      <PersonPicker
        candidates={candidates}
        value={reason.defaultAssigneeZohoUserId}
        busy={busy}
        ariaLabel={`Level 2 assignee for ${reason.label}`}
        onPick={(c) => void save(c.zohoUserId, c.name)}
        onClear={() => void save(null, '')}
      />
      <div className={e.rowActions}>
        {reason.routed ? <span className={s.pillGood}>ready</span> : <span className={s.pillWarn}>gap</span>}
      </div>
    </div>
  );
}

function DepartmentRow({
  dept,
  candidates,
  onSaved,
  onRequestRemove,
  removing,
}: {
  dept: DepartmentRouting;
  candidates: RoutingCandidate[];
  onSaved: () => Promise<void>;
  onRequestRemove: (seat: PendingRemoval) => void;
  /** A removal from THIS department's roster is in flight at the panel root. */
  removing: boolean;
}) {
  const [busy, setBusy] = useState<'manager' | 'default' | null>(null);
  const needsManager = dept.acceptsEscalations && !dept.managerZohoUserId;
  // Level 2 mirrors resolveDepartmentAgent exactly — default assignee, else the first seat that is BOTH
  // active and accepting new work; the manager is deliberately not a fallback there. Without this a
  // department with a manager and nothing at level 2 rendered "ready" while the server refused every
  // escalation raised against it.
  const level2Unroutable =
    dept.acceptsEscalations &&
    dept.department !== C_LEVEL &&
    !dept.defaultAssigneeZohoUserId &&
    !dept.pool.some((p) => p.active && p.acceptsNew);
  // Name the rung, not just "gap": the refusal the agent sees names one specific level.
  const gaps: string[] = [];
  if (level2Unroutable) gaps.push('no level-2 route — escalations opened against it are refused');
  if (needsManager) gaps.push('no level-3 manager');

  async function saveManager(id: string | null, name: string | null): Promise<void> {
    setBusy('manager');
    try {
      // The name is sent alongside the id so the chain can render without an HR round trip on every hop.
      await patchDepartmentRouting(dept.department, {
        managerZohoUserId: id,
        managerName: id ? name : null,
      });
      adminToast.success(
        id ? `${dept.department} manager → ${name ?? id}` : `${dept.department} has no manager`,
        id ? 'Level 3 escalations in this department go to them.' : 'Level 3 will be skipped for C-Level.',
      );
      await onSaved();
    } catch (err) {
      adminToast.error('Could not save', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  async function saveDefault(id: string | null): Promise<void> {
    setBusy('default');
    try {
      await patchDepartmentRouting(dept.department, { defaultAssigneeZohoUserId: id });
      adminToast.success(`${dept.department} hand-off target updated`);
      await onSaved();
    } catch (err) {
      adminToast.error('Could not save', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`${e.row} ${gaps.length > 0 ? e.rowGap : ''}`}>
      <div className={e.rowMain}>
        <span className={e.rowTitle}>
          {/* HR's name, not the slug: 'Billing & Accounting' is what people call it. The slug is the
              routing key and belongs in the metadata line, where it is useful for debugging. */}
          {dept.label}
          {dept.unlinked && (
            <span className={s.pillWarn} title="Not tied to an HR department yet">
              unlinked
            </span>
          )}
        </span>
        <span className={e.rowMeta}>
          <span className={e.rowCode}>{dept.department}</span>{' · '}
          {dept.acceptsEscalations ? 'Accepts escalations' : 'Not accepting escalations'}
          {dept.acceptsTickets ? ' · accepts tickets' : ''}
          {dept.pool.length > 0 ? ` · ${dept.pool.filter((p) => p.active).length} on the roster` : ''}
        </span>
        {gaps.length > 0 && <span className={e.rowMeta}>{gaps.join(' · ')}</span>}
      </div>
      <div style={{ display: 'grid', gap: '0.35rem' }}>
        <PersonPicker
          candidates={candidates}
          value={dept.managerZohoUserId}
          valueLabel={dept.managerName}
          busy={busy === 'manager'}
          hintDepartment={dept.department}
          placeholder="Manager not set — level 3 unavailable"
          ariaLabel={`Level 3 manager for ${dept.department}`}
          onPick={(c) => void saveManager(c.zohoUserId, c.name)}
          onClear={() => void saveManager(null, null)}
        />
        <PersonPicker
          candidates={candidates}
          value={dept.defaultAssigneeZohoUserId}
          busy={busy === 'default'}
          placeholder="Hand-off target not set — falls back to the manager"
          ariaLabel={`Hand-off target for ${dept.department}`}
          onPick={(c) => void saveDefault(c.zohoUserId)}
          onClear={() => void saveDefault(null)}
        />
      </div>
      <div className={e.rowActions}>
        {!dept.acceptsEscalations ? (
          <span className={s.pillNeutral}>off</span>
        ) : gaps.length > 0 ? (
          <span className={s.pillWarn}>gap</span>
        ) : (
          <span className={s.pillGood}>ready</span>
        )}
      </div>

      {/* The ROSTER. Separate from the manager and the hand-off target above, because this is who picks
          up NEW CLIENT TICKETS — the round-robin draws from exactly this list. An escalation-only
          department needs it too: the roster is its level 2 when no default assignee is set, and gating
          this on `acceptsTickets` left those departments with no way to add anybody at all. */}
      {(dept.acceptsTickets || dept.acceptsEscalations) && (
        <RosterEditor
          dept={dept}
          candidates={candidates}
          onSaved={onSaved}
          onRequestRemove={onRequestRemove}
          removing={removing}
        />
      )}
    </div>
  );
}

/**
 * Who works this department's ticket queue.
 *
 * The order shown is the ROTATION order: least-recently-assigned first, which is who gets the next ticket.
 * Showing it is deliberate — "why did that go to her and not me" should be answerable by looking, not by
 * asking. `assignedCount` is lifetime, so it stays meaningful after a quiet week.
 */
function RosterEditor({
  dept,
  candidates,
  onSaved,
  onRequestRemove,
  removing,
}: {
  dept: DepartmentRouting;
  candidates: RoutingCandidate[];
  onSaved: () => Promise<void>;
  onRequestRemove: (seat: PendingRemoval) => void;
  removing: boolean;
}) {
  const [saving, setSaving] = useState(false);
  // A removal runs at the panel root now (see PendingRemoval), so its in-flight state arrives as a
  // prop — OR them together or this rota stays clickable while one of its seats is being deleted.
  const busy = saving || removing;
  const roster = [...dept.pool].sort((a, b) => {
    // NULL last_assigned_at first: a newly added member is next in line, because they are owed work.
    const at = a.lastAssignedAt ? Date.parse(a.lastAssignedAt) : 0;
    const bt = b.lastAssignedAt ? Date.parse(b.lastAssignedAt) : 0;
    return at - bt;
  });
  const active = roster.filter((r) => r.active);
  // Who actually gets the next one, by the backend's own eligibility rule — not by display index. The
  // sort above ignores `active`/`acceptsNew`, so badging index 0 left nobody marked the moment the
  // least-recently-assigned member went on leave. Round robin only: under `least_open` the next ticket
  // goes to the smallest backlog, which rotation order says nothing about.
  const nextUp =
    dept.ticketAssignmentStrategy === 'round_robin'
      ? (roster.find((p) => p.active && p.acceptsNew)?.zohoUserId ?? null)
      : null;

  async function run(label: string, fn: () => Promise<unknown>): Promise<void> {
    setSaving(true);
    try {
      await fn();
      adminToast.success(label);
      await onSaved();
    } catch (err) {
      adminToast.error('Could not save', err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={e.poolWrap}>
      <div className={e.poolHead}>
        {/* "Roster", not "ticket roster": for a department that only accepts escalations this list is
            its level-2 landing, and no ticket ever reaches it. */}
        <span>
          Roster — {active.length} active
          {dept.acceptsTickets
            ? dept.ticketAssignmentStrategy === 'manual'
              ? ' · assignment is manual, nothing auto-assigns'
              : dept.ticketAssignmentStrategy === 'least_open'
                ? ' · next ticket goes to the smallest backlog'
                : ' · next ticket goes to whoever is at the top'
            : ' · level 2 for escalations opened against this department'}
        </span>
        {/* The strategy only governs ticket assignment, so it is meaningless — and misleading — on a
            department that does not take tickets. */}
        {dept.acceptsTickets && (
          <select
            value={dept.ticketAssignmentStrategy}
            disabled={busy}
            aria-label={`Assignment strategy for ${dept.label}`}
            onChange={(ev) =>
              void run('Assignment strategy updated', () =>
                patchDepartmentRouting(dept.department, {
                  ticketAssignmentStrategy: ev.target.value as AssignmentStrategy,
                }),
              )
            }
          >
            <option value="round_robin">Round robin</option>
            <option value="least_open">Least open</option>
            <option value="manual">Manual</option>
          </select>
        )}
      </div>

      {roster.length > 0 && (
        <div className={e.seats}>
          {roster.map((p) => (
            <span key={p.zohoUserId} className={`${e.seat} ${p.active ? '' : e.seatOff}`}>
              {p.zohoUserId === nextUp && (
                <span className={e.seatRole} title="Next in the rotation">
                  next
                </span>
              )}
              {p.displayName ?? p.zohoUserId}
              {/* A pill, not bare text: at the seat's own size the lifetime count reads as part of the
                  name ("Aziza Karimova 137"). */}
              <span className={`${s.pill} ${s.pillNeutral}`} title="Tickets assigned all time">
                {p.assignedCount}
              </span>
              <button
                type="button"
                className={e.seatX}
                title={p.active ? 'Take off the rota (keeps their place)' : 'Put back on the rota'}
                aria-label={`${p.active ? 'Deactivate' : 'Reactivate'} ${p.displayName ?? p.zohoUserId}`}
                disabled={busy}
                onClick={() =>
                  void run(p.active ? 'Taken off the rota' : 'Back on the rota', () =>
                    patchPoolSeat(dept.department, p.zohoUserId, { active: !p.active }),
                  )
                }
              >
                {p.active ? '−' : '+'}
              </button>
              {/* Removal is a hard DELETE server-side — deactivating is the reversible one, so the two
                  buttons sitting 0.4rem apart must not be one click apart in consequence. */}
              <button
                type="button"
                className={e.seatX}
                title="Remove from the roster"
                aria-label={`Remove ${p.displayName ?? p.zohoUserId} from the roster`}
                disabled={busy}
                onClick={() =>
                  onRequestRemove({
                    department: dept.department,
                    zohoUserId: p.zohoUserId,
                    name: p.displayName ?? p.zohoUserId,
                    title: `Remove ${p.displayName ?? p.zohoUserId} from the roster?`,
                    body: 'Removes their rotation history (assignedCount/lastAssignedAt) for good — re-added, they go to the front of the rotation. Use Deactivate instead if they are only away.',
                  })
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <PersonPicker
        candidates={candidates}
        value={null}
        busy={busy}
        hintDepartment={dept.department}
        placeholder={roster.length === 0 ? 'Add the first person to this rota…' : 'Add someone to the rota…'}
        ariaLabel={`Add someone to the ${dept.label} ${dept.acceptsTickets ? 'ticket roster' : 'roster'}`}
        onPick={(c) =>
          void run(`${c.name} added to the ${dept.label} rota`, () =>
            upsertPoolSeat(dept.department, { zohoUserId: c.zohoUserId, displayName: c.name }),
          )
        }
      />
    </div>
  );
}

function CLevelPool({
  seats,
  candidates,
  onSaved,
  onRequestRemove,
  removing,
}: {
  seats: RoutingSnapshot['cLevel'];
  candidates: RoutingCandidate[];
  onSaved: () => Promise<void>;
  onRequestRemove: (seat: PendingRemoval) => void;
  removing: boolean;
}) {
  const [saving, setSaving] = useState(false);
  // The removal itself runs at the panel root (see PendingRemoval); its in-flight state still has to
  // disable this pool, or a seat can be added while another is mid-delete.
  const busy = saving || removing;
  // Starts empty, not at 'CEO': a default would silently label whoever is added first, and the title is
  // the whole reason a pool exists here.
  const [roleTitle, setRoleTitle] = useState('');
  const title = roleTitle.trim();

  async function add(c: RoutingCandidate): Promise<void> {
    setSaving(true);
    try {
      await upsertPoolSeat(C_LEVEL, {
        zohoUserId: c.zohoUserId,
        displayName: c.name,
        roleTitle: title,
      });
      adminToast.success(`${c.name} added as ${title}`);
      await onSaved();
      // Cleared only on success: the next pick from this same picker would otherwise inherit this
      // seat's title, and two seats both reading "CEO" is exactly what the pool is meant to prevent.
      // A failed add keeps what was typed.
      setRoleTitle('');
    } catch (err) {
      adminToast.error('Could not add', err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={e.row} style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(240px, 22rem) auto' }}>
      <div className={e.rowMain}>
        <span className={e.rowTitle}>C-Level pool</span>
        <span className={e.rowMeta}>
          {seats.length === 0
            ? 'Empty — “Escalate to C-Level” is unavailable'
            : `${seats.filter((p) => p.active).length} active of ${seats.length}`}
        </span>
        {seats.length > 0 && (
          <div className={e.seats} style={{ marginTop: '0.35rem' }}>
            {seats.map((p) => (
              <span key={p.zohoUserId} className={`${e.seat} ${p.active ? '' : e.seatOff}`}>
                {p.roleTitle && <span className={e.seatRole}>{p.roleTitle}</span>}
                {p.displayName ?? p.zohoUserId}
                <button
                  type="button"
                  className={e.seatX}
                  title="Remove from the C-Level pool"
                  // aria-label, not just the title: the button's own text is "×", and text content wins
                  // over title in accessible-name computation — every seat would announce as "×".
                  aria-label={`Remove ${p.displayName ?? p.zohoUserId}${
                    p.roleTitle ? ` (${p.roleTitle})` : ''
                  } from the C-Level pool`}
                  disabled={busy}
                  onClick={() =>
                    onRequestRemove({
                      department: C_LEVEL,
                      zohoUserId: p.zohoUserId,
                      name: p.displayName ?? p.zohoUserId,
                      title: `Remove ${p.displayName ?? p.zohoUserId} from C-Level?`,
                      // A seat has no deactivate button, so this × is the only thing on the chip — and it
                      // deletes the row outright server-side. Emptying the pool takes level 4 away
                      // company-wide, which is worth saying out loud on the last active seat.
                      body: `Removes their rotation history (assignedCount/lastAssignedAt) for good — re-added, they go to the front of the rotation.${
                        seats.filter((q) => q.active).length === 1
                          ? ' This is the last active C-Level seat: level 4 becomes unreachable and the ladder will stop at the department manager.'
                          : ''
                      }`,
                    })
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gap: '0.35rem' }}>
        <input
          className={s.input}
          value={roleTitle}
          onChange={(ev) => setRoleTitle(ev.target.value)}
          placeholder="Role title (CEO, COO…)"
          aria-label="Role title for the next C-Level seat"
        />
        {/* A fieldset because it is the one element that disables a control through a single attribute:
            PersonPicker's only disable path is `busy`, which would relabel the button "Saving…". The
            title is required rather than defaulted — an untitled seat is unpickable by name at level 4. */}
        <fieldset
          disabled={busy || title === ''}
          style={{ margin: 0, padding: 0, border: 0, minWidth: 0 }}
        >
          <PersonPicker
            candidates={candidates}
            value={null}
            busy={busy}
            placeholder="Add a C-Level member…"
            ariaLabel="Add a C-Level member"
            onPick={(c) => void add(c)}
          />
        </fieldset>
        {title === '' && (
          <p className={s.fieldHint}>
            Give the seat a role title first — that is what the escalating manager picks.
          </p>
        )}
      </div>
      <div className={e.rowActions}>
        {seats.some((p) => p.active) ? (
          <span className={s.pillGood}>ready</span>
        ) : (
          <span className={s.pillWarn}>gap</span>
        )}
      </div>
    </div>
  );
}
