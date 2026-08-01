import { useCallback, useEffect, useState } from 'react';
import {
  getCommsRouting,
  listRoutingCandidates,
  patchDepartmentRouting,
  patchEscalationReason,
  removePoolSeat,
  upsertPoolSeat,
  type DepartmentRouting,
  type EscalationReasonRouting,
  type RoutingCandidate,
  type RoutingSnapshot,
} from '../../api/commsAdmin';
import { PersonPicker } from './PersonPicker';
import { adminToast } from './toast';
import s from './admin.module.css';
import e from './escalationRouting.module.css';

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

/** The rung colours match the ladder legend, so a row and the legend never disagree about a level. */
const RUNGS: { level: number; label: string; tone: string; where: string }[] = [
  { level: 1, label: 'Requester', tone: 'var(--tone-slate)', where: 'whoever raises it' },
  { level: 2, label: 'Agent', tone: 'var(--tone-cyan)', where: 'set per escalation reason' },
  { level: 3, label: 'Dept. Manager', tone: 'var(--tone-violet)', where: 'set per department' },
  { level: 4, label: 'C-Level', tone: 'var(--tone-amber)', where: 'the C-Level pool' },
];

export function EscalationRouting() {
  const [snap, setSnap] = useState<RoutingSnapshot | null>(null);
  const [candidates, setCandidates] = useState<RoutingCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      // Together: the screen is unusable with only one of them, so a single await keeps it to one
      // loading state rather than two staggered ones.
      const [routing, people] = await Promise.all([
        getCommsRouting(),
        listRoutingCandidates({ limit: 500 }),
      ]);
      setSnap(routing);
      setCandidates(people.candidates);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Refresh from the server after every save rather than patching local state: `readiness` is derived
  // server-side, and a locally-patched copy would drift from the numbers the agents' refusals use.
  const refresh = useCallback(async () => {
    try {
      setSnap(await getCommsRouting());
    } catch (err) {
      adminToast.error('Saved, but the screen could not refresh', err instanceof Error ? err.message : undefined);
    }
  }, []);

  if (loading) {
    return (
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
    );
  }

  if (error && !snap) {
    return (
      <div className={s.errorState} role="alert">
        <p className={s.errorText}>{error}</p>
        <div className={s.errorActions}>
          <button type="button" className={s.primaryBtn} onClick={() => void load()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!snap) return <div className={s.none}>No routing configuration available.</div>;

  const reasons = [...snap.escalationReasons].sort((a, b) => a.sortOrder - b.sortOrder);
  const routedCount = reasons.filter((r) => r.active && r.routed).length;
  const activeReasons = reasons.filter((r) => r.active).length;
  const escalationDepts = snap.departments.filter((d) => d.acceptsEscalations);
  const withManager = escalationDepts.filter((d) => d.managerZohoUserId).length;
  const cLevelSeats = snap.cLevel.filter((p) => p.active);

  return (
    <>
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
          <h3 className={s.h2}>Level 2 — who each reason falls to</h3>
        </div>
        <p className={e.sectionSub}>
          Choosing a reason IS choosing the person it lands on. An unrouted reason cannot be escalated on
          at all — the agent is refused rather than filing into an empty inbox.
        </p>
        <div className={e.rows}>
          {reasons.map((r) => (
            <ReasonRow key={r.code} reason={r} candidates={candidates} onSaved={refresh} />
          ))}
        </div>
      </section>

      <section className={e.section}>
        <div className={e.sectionHead}>
          <h3 className={s.h2}>Level 3 — the department manager</h3>
        </div>
        <p className={e.sectionSub}>
          Where an escalation rises to from the agent level. Also sets who receives a sideways hand-off
          into this department. Escalations already in flight keep the assignee they were given.
        </p>
        <div className={e.rows}>
          {snap.departments
            .filter((d) => d.department !== C_LEVEL)
            .map((d) => (
              <DepartmentRow key={d.department} dept={d} candidates={candidates} onSaved={refresh} />
            ))}
        </div>
      </section>

      <section className={e.section}>
        <div className={e.sectionHead}>
          <h3 className={s.h2}>Level 4 — the C-Level pool</h3>
        </div>
        <p className={e.sectionSub}>
          A pool and not a single field, because level 4 is the CEO <em>and</em> the COO — the escalating
          manager picks which. Give each seat a role title so &ldquo;Escalate to CEO&rdquo; is
          distinguishable from &ldquo;Escalate to COO&rdquo;.
        </p>
        <CLevelPool seats={snap.cLevel} candidates={candidates} onSaved={refresh} />
      </section>
    </>
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
}: {
  dept: DepartmentRouting;
  candidates: RoutingCandidate[];
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<'manager' | 'default' | null>(null);
  const needsManager = dept.acceptsEscalations && !dept.managerZohoUserId;

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
    <div className={`${e.row} ${needsManager ? e.rowGap : ''}`}>
      <div className={e.rowMain}>
        <span className={e.rowTitle}>{dept.department}</span>
        <span className={e.rowMeta}>
          {dept.acceptsEscalations ? 'Accepts escalations' : 'Not accepting escalations'}
          {dept.acceptsTickets ? ' · accepts tickets' : ''}
          {dept.pool.length > 0 ? ` · ${dept.pool.filter((p) => p.active).length} on the roster` : ''}
        </span>
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
        ) : needsManager ? (
          <span className={s.pillWarn}>gap</span>
        ) : (
          <span className={s.pillGood}>ready</span>
        )}
      </div>
    </div>
  );
}

function CLevelPool({
  seats,
  candidates,
  onSaved,
}: {
  seats: RoutingSnapshot['cLevel'];
  candidates: RoutingCandidate[];
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [roleTitle, setRoleTitle] = useState('CEO');

  async function add(c: RoutingCandidate): Promise<void> {
    setBusy(true);
    try {
      await upsertPoolSeat(C_LEVEL, {
        zohoUserId: c.zohoUserId,
        displayName: c.name,
        roleTitle: roleTitle.trim() || null,
      });
      adminToast.success(`${c.name} added as ${roleTitle.trim() || 'C-Level'}`);
      await onSaved();
    } catch (err) {
      adminToast.error('Could not add', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function remove(zohoUserId: string, name: string): Promise<void> {
    setBusy(true);
    try {
      await removePoolSeat(C_LEVEL, zohoUserId);
      // Escalations already at level 4 keep the person their hop recorded — the chain snapshots its
      // assignee, so removing a seat never rewrites history.
      adminToast.success(`${name} removed from C-Level`, 'Escalations already with them are unchanged.');
      await onSaved();
    } catch (err) {
      adminToast.error('Could not remove', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
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
                  disabled={busy}
                  onClick={() => void remove(p.zohoUserId, p.displayName ?? p.zohoUserId)}
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
        <PersonPicker
          candidates={candidates}
          value={null}
          busy={busy}
          placeholder="Add a C-Level member…"
          ariaLabel="Add a C-Level member"
          onPick={(c) => void add(c)}
        />
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
