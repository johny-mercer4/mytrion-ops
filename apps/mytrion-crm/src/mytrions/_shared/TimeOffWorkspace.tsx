import { useCallback, useEffect, useMemo, useState } from 'react';
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
  ShieldCheck,
  SunMedium,
  Umbrella,
  X,
} from 'lucide-react';
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
import styles from './TimeOffWorkspace.module.css';

type View = 'summary' | 'mine' | 'inbox' | 'all';

const TYPE_ICON = {
  sick: HeartPulse,
  annual_paid: Umbrella,
  unpaid: CircleDollarSign,
} satisfies Record<LeaveTypeCode, typeof HeartPulse>;

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
  onOpen,
}: {
  item: LeaveRequestDto;
  showEmployee: boolean;
  onOpen: () => void;
}) {
  const Icon = TYPE_ICON[item.leaveTypeCode];
  return (
    <button type="button" className={styles.requestRow} onClick={onOpen}>
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
      <ChevronRight size={18} className={styles.chevron} />
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
  onSubmitted: () => Promise<void>;
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
      await onSubmitted();
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
          <input type="date" value={fromDate} onChange={(event) => {
            setFromDate(event.target.value);
            if (!toDate || event.target.value > toDate) setToDate(event.target.value);
          }} />
        </label>
        <label className={styles.field}>
          <span>To</span>
          <input type="date" min={fromDate} value={toDate} onChange={(event) => setToDate(event.target.value)} />
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
  onClose,
  onChanged,
}: {
  item: LeaveRequestDto;
  actions: LeaveRequestActionDto[];
  canDecide: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
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
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };
  const pending = item.status === 'pending_lead' || item.status === 'pending_hr';
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
      {canDecide ? (
        <label className={styles.field}>
          <span>Decision note</span>
          <textarea value={comment} rows={2} maxLength={2000} onChange={(event) => setComment(event.target.value)} placeholder="Optional note to the employee…" />
        </label>
      ) : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <div className={styles.formActions}>
        {pending && !canDecide ? <button type="button" className={styles.dangerBtn} disabled={busy !== null} onClick={() => void act('cancel')}>Cancel request</button> : null}
        {canDecide ? <>
          <button type="button" className={styles.dangerBtn} disabled={busy !== null} onClick={() => void act('reject')}>Reject</button>
          <button type="button" className={styles.primaryBtn} disabled={busy !== null} onClick={() => void act('approve')}><Check size={16} />Approve</button>
        </> : null}
      </div>
    </div>
  );
}

export function TimeOffWorkspace({
  includeAll = false,
  embedded = false,
}: {
  includeAll?: boolean;
  embedded?: boolean;
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
  const [applyOpen, setApplyOpen] = useState(false);
  const [detail, setDetail] = useState<{ item: LeaveRequestDto; actions: LeaveRequestActionDto[] } | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const [nextOverview, nextTypes, nextMine, nextInbox, nextAll] = await Promise.all([
        getTimeOffOverview(year, signal),
        listLeaveTypes(signal),
        listLeaveRequests({ scope: 'mine', year, limit: 200 }, signal),
        listLeaveRequests({ scope: 'inbox', year, limit: 200 }, signal),
        includeAll ? listLeaveRequests({ scope: 'all', year, limit: 300 }, signal) : Promise.resolve([]),
      ]);
      setOverview(nextOverview);
      setTypes(nextTypes);
      setMine(nextMine);
      setInbox(nextInbox);
      setAll(nextAll);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setLoading(false);
    }
  }, [includeAll, year]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const openDetail = async (item: LeaveRequestDto): Promise<void> => {
    setError('');
    try {
      setDetail(await getLeaveRequestDetail(item.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const changed = async (): Promise<void> => {
    setApplyOpen(false);
    setDetail(null);
    await load();
  };
  const visible = useMemo(
    () => view === 'mine' ? mine : view === 'inbox' ? inbox : all,
    [all, inbox, mine, view],
  );

  if (loading && !overview) {
    return <div className={styles.loading}><Loader2 size={24} className={styles.spin} /><span>Preparing your leave calendar…</span></div>;
  }

  return (
    <div className={`${styles.workspace} ${embedded ? styles.embedded : ''}`}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>People · Time off</span>
          <h2>{embedded ? 'Time Off' : 'My time off'}</h2>
          <p>{overview ? `${overview.employee.name} · ${overview.employee.department ?? 'No department'}` : 'Leave and approvals'}</p>
        </div>
        <div className={styles.headerActions}>
          <label className={styles.yearPicker}><CalendarDays size={16} /><select value={year} onChange={(event) => setYear(Number(event.target.value))}><option value={currentYear - 1}>{currentYear - 1}</option><option value={currentYear}>{currentYear}</option><option value={currentYear + 1}>{currentYear + 1}</option></select></label>
          <button type="button" className={styles.primaryBtn} onClick={() => { setDetail(null); setApplyOpen(true); }}><Plus size={17} />Apply leave</button>
        </div>
      </header>
      <nav className={styles.tabs} aria-label="Time off views">
        <button type="button" className={view === 'summary' ? styles.tabActive : ''} onClick={() => setView('summary')}>Summary</button>
        <button type="button" className={view === 'mine' ? styles.tabActive : ''} onClick={() => setView('mine')}>My requests <span>{mine.length}</span></button>
        <button type="button" className={view === 'inbox' ? styles.tabActive : ''} onClick={() => setView('inbox')}>To approve <span>{inbox.length}</span></button>
        {includeAll ? <button type="button" className={view === 'all' ? styles.tabActive : ''} onClick={() => setView('all')}>All requests <span>{all.length}</span></button> : null}
      </nav>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {applyOpen ? <ApplyForm types={types} onCancel={() => setApplyOpen(false)} onSubmitted={changed} /> : null}
      {detail ? <DetailPanel item={detail.item} actions={detail.actions} canDecide={inbox.some((item) => item.id === detail.item.id)} onClose={() => setDetail(null)} onChanged={changed} /> : null}
      {!applyOpen && !detail && view === 'summary' && overview ? (
        <div className={styles.summary}>
          <div className={styles.balanceGrid}>{overview.balances.map((balance) => <BalanceCard key={balance.leaveTypeId} balance={balance} />)}</div>
          <section className={styles.holidays}>
            <div className={styles.sectionTitle}><div><span>Company calendar</span><h3>Holidays in {year}</h3></div><SunMedium size={21} /></div>
            <div className={styles.holidayList}>
              {overview.holidays.length ? overview.holidays.map((holiday) => (
                <div key={holiday.id} className={styles.holidayRow}><span className={styles.holidayDate}>{new Date(`${holiday.date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' })}</span><strong>{holiday.name}</strong><span>{holiday.isHalfDay ? `${holiday.session} half-day` : holiday.location}</span></div>
              )) : <p className={styles.muted}>No holidays configured for this year.</p>}
            </div>
          </section>
        </div>
      ) : null}
      {!applyOpen && !detail && view !== 'summary' ? (
        <section className={styles.requestList}>
          <div className={styles.listHead}><div><span>{view === 'inbox' ? 'Approval queue' : view === 'all' ? 'HR register' : 'Your history'}</span><h3>{view === 'inbox' ? 'Requests needing your decision' : view === 'all' ? 'All employee leave' : `${year} requests`}</h3></div>{loading ? <Loader2 size={18} className={styles.spin} /> : null}</div>
          {visible.length ? visible.map((item) => <RequestRow key={item.id} item={item} showEmployee={view !== 'mine'} onOpen={() => void openDetail(item)} />) : <EmptyList view={view} />}
        </section>
      ) : null}
    </div>
  );
}
