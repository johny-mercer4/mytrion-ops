import { MYTRIONS, type MytrionId } from '../../access/mytrions.config';
import type { MytrionAccessMode } from '../../api/mytrionAccess';
import s from './admin.module.css';

/**
 * Read-only / Full access, for ANY granted Mytrion.
 *
 * Replaces the hardcoded Billing-only control. The data model has carried `read | full` for every
 * Mytrion since migration 0057, and five backends already enforce it —
 * `requireMytrionWrite(request, 'hr' | 'recruit' | 'sales' | 'billing', …)` plus Manager's bespoke
 * guard — but the only one an admin could actually SET was Billing. So an `hr: 'read'` grant was
 * refusable by the server and unreachable from the UI: it could only be created by editing the
 * database by hand.
 *
 * The toggle is shown for every granted Mytrion, including ones with no write-gated route yet.
 * Storing `read` there is harmless and forward-compatible — it starts being enforced the day the
 * first gated route lands — but the hint text says so rather than promising a gate that does not
 * exist.
 */

/**
 * Mytrions whose write paths are gated on the mode TODAY.
 *
 * Mirrors `MYTRION_WRITE_ENFORCED` in src/lib/mytrions.ts. Drives hint copy only — never whether the
 * control renders — so a drift here is cosmetic, not a permissions hole.
 */
const WRITE_ENFORCED = new Set<MytrionId>(['billing', 'hr', 'recruit', 'sales', 'marketing']);

/** Kept verbatim from the Billing-only control it replaces — it is the most specific copy we have. */
const HINTS: Partial<Record<MytrionId, string>> = {
  billing:
    'Full access can map/unmap payments and match returns. Read-only can view Data Center, Transactions, Debtors, Prepay, and Returns — but not change them.',
  hr: 'Full access can approve time off and edit employee records. Read-only can view the directory and attendance.',
  recruit: 'Full access can edit jobs and move candidates. Read-only can view the pipeline.',
  sales: 'Full access can issue money codes and manage carrier cards from the mini-app.',
  marketing: 'Full access can override a carrier’s loyalty tier and rewards. Read-only can view both programs.',
};

export function MytrionAccessModeField({
  mytrionId,
  value,
  onChange,
}: {
  mytrionId: MytrionId;
  value: MytrionAccessMode;
  onChange: (mode: MytrionAccessMode) => void;
}) {
  const title = MYTRIONS[mytrionId]?.title ?? mytrionId;
  const hint =
    HINTS[mytrionId] ??
    (WRITE_ENFORCED.has(mytrionId)
      ? 'Read-only can open this workspace but not change anything in it.'
      : 'No write-gated actions in this workspace yet — a Read-only grant here starts enforcing when the first one lands.');

  return (
    <div className={s.field}>
      <span className={s.fieldLabel}>{title} permission</span>
      <div className={s.profileModeRow}>
        {(
          [
            { id: 'full' as const, label: 'Full access' },
            { id: 'read' as const, label: 'Read-only' },
          ]
        ).map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={value === m.id}
            className={`${s.filterChip} ${value === m.id ? s.filterChipOn : ''}`}
            onClick={() => onChange(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className={s.noticeNote} style={{ marginTop: 6 }}>
        {hint}
      </p>
    </div>
  );
}
