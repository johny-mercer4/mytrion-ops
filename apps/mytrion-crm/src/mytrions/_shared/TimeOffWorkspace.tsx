import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  HeartPulse,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  SunMedium,
  Umbrella,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  cancelLeaveRequest,
  decideLeaveRequest,
  getLeaveRequestDetail,
  getTimeOffOverview,
  listLeaveRequests,
  listLeaveTypes,
  submitLeaveRequest,
  type LeaveBalanceDto,
  type LeaveDayPart,
  type LeaveRequestActionDto,
  type LeaveRequestDto,
  type LeaveRequestStatus,
  type LeaveTypeCode,
  type LeaveTypeDto,
  type TimeOffOverviewDto,
} from '../../api/hrTimeOff';
import { ApiError } from '../../api/transport';
import { HrPageLoader } from '../hr/HrBits';
import styles from './TimeOffWorkspace.module.css';

type View = 'summary' | 'mine' | 'inbox' | 'all';

const TYPE_ICON = {
  sick: HeartPulse,
  annual_paid: Umbrella,
  unpaid: CircleDollarSign,
} satisfies Record<LeaveTypeCode, typeof HeartPulse>;

// Every year-taking leave endpoint validates with z.coerce.number().int().min(2020).max(2100)
// (src/routes/v1/hrLeave.routes.ts), so a year outside this window makes the overview/list fetches
// fail validation rather than return an empty page. Keep both the picker and the post-submit
// year-follow inside it.
const API_YEAR_MIN = 2020;
const API_YEAR_MAX = 2100;
const API_DATE_MIN = `${API_YEAR_MIN}-01-01`;
const API_DATE_MAX = `${API_YEAR_MAX}-12-31`;

const STATUS_LABEL: Record<LeaveRequestStatus, string> = {
  pending_lead: 'Department lead',
  pending_hr: 'HR final review',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

function employeeName(item: LeaveRequestDto): string {
  return `${item.employee.firstName} ${item.employee.lastName}`.trim();
}

function days(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function statusTone(status: LeaveRequestStatus): string {
  if (status === 'approved') return styles.statusApproved ?? '';
  if (status === 'rejected' || status === 'cancelled') return styles.statusClosed ?? '';
  return styles.statusPending ?? '';
}

function BalanceCard({ balance }: { balance: LeaveBalanceDto }) {
  const Icon = TYPE_ICON[balance.code];
  const used = balance.approvedDays + balance.pendingDays;
  const total = balance.allocatedDays + balance.adjustmentDays;
  const pct = total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : 0;
  return (
    <article className={`${styles.balanceCard} ${styles[`tone_${balance.code}`]}`}>
      <div className={styles.balanceTop}>
        <span className={styles.balanceIcon}><Icon size={21} /></span>
        <span className={styles.paidPill}>{balance.isPaid ? 'Paid' : 'Unpaid'}</span>
      </div>
      <h3>{balance.name}</h3>
      <div className={styles.balanceValue}>
        <strong>{days(balance.availableDays)}</strong>
        <span>days available</span>
      </div>
      <div className={styles.balanceTrack}><span style={{ width: `${pct}%` }} /></div>
      <div className={styles.balanceMeta}>
        <span>{days(balance.approvedDays)} booked</span>
        <span>{days(balance.pendingDays)} pending</span>
        <span>{days(total)} allowance</span>
      </div>
    </article>
  );
}

function RequestRow({
  item,
  showEmployee,
  busy,
  onOpen,
}: {
  item: LeaveRequestDto;
  showEmployee: boolean;
  busy: boolean;
  onOpen: () => void;
}) {
  const Icon = TYPE_ICON[item.leaveTypeCode];
  return (
    <button type="button" className={styles.requestRow} onClick={onOpen} aria-busy={busy}>
      <span className={`${styles.requestIcon} ${styles[`tone_${item.leaveTypeCode}`]}`}>
        <Icon size={18} />
      </span>
      <span className={styles.requestMain}>
        <strong>{showEmployee ? employeeName(item) : item.leaveTypeName}</strong>
        <span>
          {showEmployee ? `${item.leaveTypeName} · ` : ''}
          {formatDate(item.fromDate)}
          {item.toDate !== item.fromDate ? ` – ${formatDate(item.toDate)}` : ''}
        </span>
      </span>
      <span className={styles.requestDays}>{days(item.requestedDays)}d</span>
      <span className={`${styles.status} ${statusTone(item.status)}`}>
        {STATUS_LABEL[item.status]}
      </span>
      {busy
        ? <Loader2 size={18} className={`${styles.chevron} ${styles.spin}`} />
        : <ChevronRight size={18} className={styles.chevron} />}
    </button>
  );
}

function EmptyList({ view }: { view: View }) {
  const inbox = view === 'inbox';
  return (
    <div className={styles.empty}>
      <span><CalendarCheck size={25} /></span>
      <strong>{inbox ? 'Approval queue is clear' : 'No time-off requests here'}</strong>
      <p>{inbox ? 'New requests will appear as soon as your decision is needed.' : 'The selected year has no matching records.'}</p>
    </div>
  );
}

function ApplyForm({
  types,
  onCancel,
  onSubmitted,
}: {
  types: LeaveTypeDto[];
  onCancel: () => void;
  onSubmitted: (fromDate: string) => void;
}) {
  const [leaveTypeId, setLeaveTypeId] = useState(types[0]?.id ?? '');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [dayPart, setDayPart] = useState<LeaveDayPart>('full');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async (): Promise<void> => {
    if (!leaveTypeId || !fromDate || !toDate) {
      setError('Choose a leave type and date range.');
      return;
    }
    // The submit endpoint only checks that these are real calendar dates, so a 4-digit-year typo
    // (0025-08-01) posts fine and then breaks every year-scoped follow-up read. Reject it here —
    // the input min/max only fire on native form validation, which this non-form button skips.
    if (fromDate < API_DATE_MIN || fromDate > API_DATE_MAX || toDate < API_DATE_MIN || toDate > API_DATE_MAX) {
      setError(`Dates must fall between ${API_YEAR_MIN} and ${API_YEAR_MAX}.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await submitLeaveRequest({
        leaveTypeId,
        fromDate,
        toDate,
        dayPart,
        reason: reason.trim() || null,
      });
      toast.success('Request submitted — awaiting your lead');
      // The lists are year-scoped by fromDate, so the workspace needs the range to follow it there.
      onSubmitted(fromDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className={styles.formPanel}>
      <div className={styles.panelTitle}>
        <div><span>New request</span><h3>Apply for time off</h3></div>
        <button type="button" className={styles.iconBtn} onClick={onCancel} aria-label="Close form"><X size={18} /></button>
      </div>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>Leave type</span>
          <select value={leaveTypeId} onChange={(event) => setLeaveTypeId(event.target.value)}>
            {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span>Day</span>
          <select value={dayPart} onChange={(event) => setDayPart(event.target.value as LeaveDayPart)}>
            <option value="full">Full day</option>
            <option value="morning">Morning half</option>
            <option value="afternoon">Afternoon half</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>From</span>
          <input type="date" min={API_DATE_MIN} max={API_DATE_MAX} value={fromDate} onChange={(event) => {
            setFromDate(event.target.value);
            if (!toDate || event.target.value > toDate) setToDate(event.target.value);
          }} />
        </label>
        <label className={styles.field}>
          <span>To</span>
          <input type="date" min={fromDate || API_DATE_MIN} max={API_DATE_MAX} value={toDate} onChange={(event) => setToDate(event.target.value)} />
        </label>
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span>Reason or handoff note</span>
          <textarea value={reason} maxLength={2000} rows={3} onChange={(event) => setReason(event.target.value)} placeholder="Optional context for your lead and HR…" />
        </label>
      </div>
      <div className={styles.workflowHint}>
        <ShieldCheck size={18} />
        <span>Your department lead reviews first. HR gives the final decision.</span>
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <div className={styles.formActions}>
        <button type="button" className={styles.secondaryBtn} onClick={onCancel}>Cancel</button>
        <button type="button" className={styles.primaryBtn} disabled={busy} onClick={() => void save()}>
          {busy ? <Loader2 size={16} className={styles.spin} /> : <Check size={16} />}
          Submit request
        </button>
      </div>
    </div>
  );
}

function DetailPanel({
  item,
  actions,
  canDecide,
  isOwn,
  readOnly,
  onClose,
  onChanged,
}: {
  item: LeaveRequestDto;
  actions: LeaveRequestActionDto[];
  canDecide: boolean;
  isOwn: boolean;
  readOnly: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | 'cancel' | null>(null);
  const [error, setError] = useState('');
  const act = async (kind: 'approve' | 'reject' | 'cancel'): Promise<void> => {
    setBusy(kind);
    setError('');
    try {
      if (kind === 'cancel') await cancelLeaveRequest(item.id);
      else await decideLeaveRequest(item.id, { decision: kind, comment: comment.trim() || null });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      // onChanged() no longer awaits the reload, so the panel can outlive the write — clear the
      // spinner here rather than relying on being unmounted.
      setBusy(null);
    }
  };
  const pending = item.status === 'pending_lead' || item.status === 'pending_hr';
  // A sign-in with no linked employee record may read the register but cannot write: every write
  // resolves an actor employee row first, so its buttons could only ever fail.
  const showDecide = canDecide && !readOnly;
  // Cancelling is the requester's own escape hatch — the repo scopes it to the caller's employee
  // id, so offering it on a colleague's request produces nothing but a conflict. Not exclusive
  // with showDecide: an HR final approver with no department lead is their own current approver.
  const showCancel = pending && isOwn && !readOnly;
  return (
    <div className={styles.detailPanel}>
      <div className={styles.panelTitle}>
        <div><span>Request {item.id.slice(-8).toUpperCase()}</span><h3>{item.leaveTypeName}</h3></div>
        <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close details"><X size={18} /></button>
      </div>
      <div className={styles.detailHero}>
        <div><span>Employee</span><strong>{employeeName(item)}</strong><small>{item.employee.department ?? 'No department'}</small></div>
        <div><span>Dates</span><strong>{formatDate(item.fromDate)}</strong><small>{item.toDate === item.fromDate ? item.dayPart.replace('_', ' ') : `through ${formatDate(item.toDate)}`}</small></div>
        <div><span>Duration</span><strong>{days(item.requestedDays)} days</strong><small>{item.leaveTypeCode === 'unpaid' ? 'Unpaid' : 'Paid leave'}</small></div>
      </div>
      <div className={styles.detailStatus}>
        <Clock3 size={17} />
        <div><strong>{STATUS_LABEL[item.status]}</strong><span>{item.currentApproverName ? `With ${item.currentApproverName}` : 'Workflow complete'}</span></div>
      </div>
      {item.reason ? <div className={styles.reason}><span>Request note</span><p>{item.reason}</p></div> : null}
      <div className={styles.timeline}>
        {actions.map((action) => (
          <div key={action.id} className={styles.timelineItem}>
            <span className={styles.timelineDot} />
            <div><strong>{action.action.replaceAll('_', ' ')}</strong><small>{new Date(action.createdAt).toLocaleString()}</small>{action.comment ? <p>{action.comment}</p> : null}</div>
          </div>
        ))}
      </div>
      {showDecide ? (
        <label className={styles.field}>
          <span>Decision note</span>
          <textarea value={comment} rows={2} maxLength={2000} onChange={(event) => setComment(event.target.value)} placeholder="Optional note to the employee…" />
        </label>
      ) : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {showCancel || showDecide ? (
        <div className={styles.formActions}>
          {showCancel ? <button type="button" className={styles.dangerBtn} disabled={busy !== null} onClick={() => void act('cancel')}>Cancel request</button> : null}
          {showDecide ? <>
            <button type="button" className={styles.dangerBtn} disabled={busy !== null} onClick={() => void act('reject')}>Reject</button>
            <button type="button" className={styles.primaryBtn} disabled={busy !== null} onClick={() => void act('approve')}><Check size={16} />Approve</button>
          </> : null}
        </div>
      ) : null}
    </div>
  );
}

export function TimeOffWorkspace({
  includeAll = false,
  embedded = false,
  canApprove = false,
}: {
  includeAll?: boolean;
  embedded?: boolean;
  /**
   * Show the "To approve" inbox tab. Team leads (their own team) and HR/admins (final review) can
   * approve; a plain employee approves nobody, so the tab is hidden for them. UI-gating only — the
   * backend re-checks every decision. As a backstop the tab also shows whenever the server actually
   * handed this caller items to approve, so a real approver is never left without the inbox.
   */
  canApprove?: boolean;
}) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [view, setView] = useState<View>('summary');
  const [overview, setOverview] = useState<TimeOffOverviewDto | null>(null);
  const [types, setTypes] = useState<LeaveTypeDto[]>([]);
  const [mine, setMine] = useState<LeaveRequestDto[]>([]);
  const [inbox, setInbox] = useState<LeaveRequestDto[]>([]);
  const [all, setAll] = useState<LeaveRequestDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [personalUnavailable, setPersonalUnavailable] = useState('');
  const [registerUnavailable, setRegisterUnavailable] = useState('');
  const [applyOpen, setApplyOpen] = useState(false);
  const [detail, setDetail] = useState<{ item: LeaveRequestDto; actions: LeaveRequestActionDto[] } | null>(null);
  const [pendingDetailId, setPendingDetailId] = useState<string | null>(null);
  // Bumped on every open/close/reload so a detail response that lands late cannot overwrite a
  // newer one, nor re-open a panel the user has already left.
  const detailSeq = useRef(0);
  // Reloads run through the effect (and its AbortController) instead of an imperative load(), so a
  // stale post-decision fetch can never repopulate state the user has since re-scoped.
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    setPersonalUnavailable('');
    setRegisterUnavailable('');
    try {
      const [overviewResult, typesResult, mineResult, inboxResult, allResult] = await Promise.allSettled([
        getTimeOffOverview(year, signal),
        listLeaveTypes(signal),
        listLeaveRequests({ scope: 'mine', year, limit: 200 }, signal),
        // Deliberately unscoped by year: the inbox is already limited to pending statuses, and a
        // fromDate-year filter hides next-year leave from the approver who must decide it now.
        listLeaveRequests({ scope: 'inbox', limit: 200 }, signal),
        includeAll ? listLeaveRequests({ scope: 'all', year, limit: 300 }, signal) : Promise.resolve([]),
      ]);
      if (signal?.aborted) return;

      // Each slice degrades on its own — one failed fetch must not throw away the others.
      setTypes(typesResult.status === 'fulfilled' ? typesResult.value : []);
      if (allResult.status === 'fulfilled') {
        setAll(allResult.value);
      } else {
        setAll([]);
        setRegisterUnavailable(
          `The tenant-wide register could not be loaded. ${allResult.reason instanceof Error ? allResult.reason.message : String(allResult.reason)}`,
        );
      }

      const personalFailed =
        overviewResult.status === 'rejected' ||
        mineResult.status === 'rejected' ||
        inboxResult.status === 'rejected';
      if (personalFailed) {
        setOverview(null);
        setMine([]);
        setInbox([]);
        const reason: unknown =
          overviewResult.status === 'rejected'
            ? overviewResult.reason
            : mineResult.status === 'rejected'
              ? mineResult.reason
              : inboxResult.status === 'rejected'
                ? inboxResult.reason
                : null;
        // Only a 404 means "no active employee row is linked to this sign-in"; a timeout or a 502
        // must not tell a correctly-linked employee that their account is misconfigured.
        if (includeAll && reason instanceof ApiError && reason.status === 404) {
          setPersonalUnavailable(
            'This administrator sign-in is not linked to an employee. You can review every request, but personal balances and leave applications require an employee link.',
          );
          setView('all');
        } else {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      } else {
        setOverview(overviewResult.value);
        setMine(mineResult.value);
        // Unscoped by year, so order by leave date — a January request must not hide behind
        // submittedAt ordering when the header reads December.
        setInbox([...inboxResult.value].sort((a, b) => a.fromDate.localeCompare(b.fromDate)));
      }
    } catch (err) {
      if (!signal?.aborted && !(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [includeAll, year]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadKey]);

  useEffect(() => () => { detailSeq.current += 1; }, []);

  const openDetail = async (item: LeaveRequestDto): Promise<void> => {
    detailSeq.current += 1;
    const seq = detailSeq.current;
    setPendingDetailId(item.id);
    setError('');
    try {
      const loaded = await getLeaveRequestDetail(item.id);
      if (detailSeq.current === seq) setDetail(loaded);
    } catch (err) {
      if (detailSeq.current === seq) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (detailSeq.current === seq) setPendingDetailId(null);
    }
  };
  const closeDetail = (): void => {
    detailSeq.current += 1;
    setPendingDetailId(null);
    setDetail(null);
  };
  const retry = (): void => setReloadKey((key) => key + 1);
  const changed = (submittedFrom?: string): void => {
    setApplyOpen(false);
    closeDetail();
    if (submittedFrom !== undefined) {
      setView('mine');
      const submittedYear = Number(submittedFrom.slice(0, 4));
      // Every list is fromDate-year-filtered server-side, so follow the request into its own year
      // or it lands in no list at all. setYear alone re-runs the effect-owned load. Only follow a
      // year the API will accept: adopting an out-of-range one makes all four reads fail schema
      // validation, which blanks the overview and leaves the workspace stuck in its error state.
      if (
        Number.isInteger(submittedYear) &&
        submittedYear >= API_YEAR_MIN &&
        submittedYear <= API_YEAR_MAX &&
        submittedYear !== year
      ) {
        setYear(submittedYear);
        return;
      }
    }
    retry();
  };
  const visible = useMemo(
    () => view === 'mine' ? mine : view === 'inbox' ? inbox : all,
    [all, inbox, mine, view],
  );
  // The overview carries the year it was computed for, so a payload left over from the previous
  // selection must not be rendered under the new year's heading.
  const staleYear = overview !== null && overview.year !== year;
  // A submitted request can fall outside the three offered years; keep the picker truthful.
  const yearOptions = useMemo(() => {
    const offered = [currentYear - 1, currentYear, currentYear + 1];
    return offered.includes(year) ? offered : [...offered, year].sort((a, b) => a - b);
  }, [currentYear, year]);

  if (loading && !overview) {
    // The loader renders inside the SAME wrapper the loaded workspace uses, so the page gutter and
    // the embedded top offset are already in place when the data lands. Returning the bare loader
    // meant the whole surface was laid out twice — once with no padding, once with 24/32px of it —
    // which is the jump that reads as a flicker on first paint.
    return (
      <div className={`${styles.workspace} ${embedded ? styles.embedded : ''}`}>
        <HrPageLoader label="Preparing your leave calendar…" />
      </div>
    );
  }

  return (
    <div className={`${styles.workspace} ${embedded ? styles.embedded : ''}`}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>People Operations</span>
          <h2>{embedded ? 'Time Off' : 'My time off'}</h2>
          <p>{overview ? `${overview.employee.name} · ${overview.employee.department ?? 'No department'}` : 'Leave and approvals'}</p>
        </div>
        <div className={styles.headerActions}>
          {error || registerUnavailable ? (
            <button type="button" className={styles.secondaryBtn} disabled={loading} onClick={retry}>
              {loading ? <Loader2 size={16} className={styles.spin} /> : <RefreshCw size={16} />}
              Retry
            </button>
          ) : null}
          {/* The icon is decorative, so the name has to live on the control itself. */}
          <label className={styles.yearPicker}><CalendarDays size={16} aria-hidden="true" /><select aria-label="Leave year" value={year} onChange={(event) => setYear(Number(event.target.value))}>{yearOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
          {overview ? <button type="button" className={styles.primaryBtn} disabled={types.length === 0} title={types.length === 0 ? 'Leave types could not be loaded — retry to apply for leave.' : undefined} onClick={() => { closeDetail(); setApplyOpen(true); }}><Plus size={17} />Apply leave</button> : null}
        </div>
      </header>
      <nav className={styles.tabs} aria-label="Time off views">
        {!personalUnavailable ? <button type="button" className={view === 'summary' ? styles.tabActive : ''} onClick={() => setView('summary')}>Summary</button> : null}
        {!personalUnavailable ? <button type="button" className={view === 'mine' ? styles.tabActive : ''} onClick={() => setView('mine')}>My requests <span>{mine.length}</span></button> : null}
        {!personalUnavailable && (canApprove || inbox.length > 0) ? <button type="button" className={view === 'inbox' ? styles.tabActive : ''} onClick={() => setView('inbox')}>To approve <span>{inbox.length}</span></button> : null}
        {includeAll ? <button type="button" className={view === 'all' ? styles.tabActive : ''} onClick={() => setView('all')}>All requests <span>{all.length}</span></button> : null}
      </nav>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {personalUnavailable ? <p className={styles.error} role="status">{personalUnavailable}</p> : null}
      {registerUnavailable ? <p className={styles.error} role="status">{registerUnavailable}</p> : null}
      {applyOpen ? <ApplyForm types={types} onCancel={() => setApplyOpen(false)} onSubmitted={changed} /> : null}
      {detail ? <DetailPanel item={detail.item} actions={detail.actions} canDecide={inbox.some((item) => item.id === detail.item.id)} isOwn={overview?.employee.id === detail.item.employee.id} readOnly={personalUnavailable !== ''} onClose={closeDetail} onChanged={changed} /> : null}
      {!applyOpen && !detail && view === 'summary' && overview ? (
        <div className={styles.summary} aria-busy={staleYear}>
          <div className={styles.balanceGrid}>
            {staleYear
              ? overview.balances.map((balance) => <div key={balance.leaveTypeId} className={`${styles.balanceCard} ${styles[`tone_${balance.code}`]}`} aria-hidden="true" />)
              : overview.balances.map((balance) => <BalanceCard key={balance.leaveTypeId} balance={balance} />)}
          </div>
          <section className={styles.holidays}>
            <div className={styles.sectionTitle}><div><span>Company calendar</span><h3>Holidays in {year}</h3></div>{staleYear ? <Loader2 size={21} className={styles.spin} /> : <SunMedium size={21} />}</div>
            <div className={styles.holidayList}>
              {staleYear ? <p className={styles.muted}>Loading {year} holidays…</p> : overview.holidays.length ? overview.holidays.map((holiday) => (
                <div key={holiday.id} className={styles.holidayRow}><span className={styles.holidayDate}>{new Date(`${holiday.date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' })}</span><strong>{holiday.name}</strong><span>{holiday.isHalfDay ? `${holiday.session} half-day` : holiday.location}</span></div>
              )) : <p className={styles.muted}>No holidays configured for this year.</p>}
            </div>
          </section>
        </div>
      ) : null}
      {!applyOpen && !detail && view === 'summary' && !overview ? (
        <section className={styles.requestList}>
          <div className={styles.empty}>
            <span><CalendarCheck size={25} /></span>
            <strong>Balances are temporarily unavailable</strong>
            <p>{error || 'Your personal leave data could not be loaded.'}</p>
            <button type="button" className={styles.secondaryBtn} disabled={loading} onClick={retry}>
              {loading ? <Loader2 size={16} className={styles.spin} /> : <RefreshCw size={16} />}
              Retry
            </button>
          </div>
        </section>
      ) : null}
      {!applyOpen && !detail && view !== 'summary' ? (
        <section className={styles.requestList}>
          <div className={styles.listHead}><div><span>{view === 'inbox' ? 'Approval queue' : view === 'all' ? 'HR register' : 'Your history'}</span><h3>{view === 'inbox' ? 'Requests needing your decision' : view === 'all' ? 'All employee leave' : `${year} requests`}</h3></div>{loading ? <Loader2 size={18} className={styles.spin} /> : null}</div>
          {visible.length ? visible.map((item) => <RequestRow key={item.id} item={item} showEmployee={view !== 'mine'} busy={pendingDetailId === item.id} onOpen={() => void openDetail(item)} />) : <EmptyList view={view} />}
        </section>
      ) : null}
    </div>
  );
}
