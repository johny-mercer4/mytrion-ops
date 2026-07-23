import type { MytrionAccessMode } from '../../api/mytrionAccess';
import s from './admin.module.css';

/** Compact Read-only / Full access control for Billing (Admin User + Role forms). */
export function BillingAccessModeField({
  value,
  onChange,
}: {
  value: MytrionAccessMode;
  onChange: (mode: MytrionAccessMode) => void;
}) {
  return (
    <div className={s.field}>
      <span className={s.fieldLabel}>Billing permission</span>
      <div className={s.profileModeRow}>
        {([
          { id: 'full' as const, label: 'Full access' },
          { id: 'read' as const, label: 'Read-only' },
        ]).map((m) => (
          <button
            key={m.id}
            type="button"
            className={`${s.filterChip} ${value === m.id ? s.filterChipOn : ''}`}
            onClick={() => onChange(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className={s.noticeNote} style={{ marginTop: 6 }}>
        Full access can map/unmap payments and match returns. Read-only can view Data Center,
        Transactions, Debtors, Prepay, and Returns — but not change them.
      </p>
    </div>
  );
}
