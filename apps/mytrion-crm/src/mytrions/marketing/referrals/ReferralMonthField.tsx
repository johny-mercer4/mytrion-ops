import { useRef } from 'react';
import { CalendarDays, ChevronRight } from 'lucide-react';
import { currentPeriodTo, monthLabel, periodLabel } from './referralPeriod';

export function ReferralMonthField({
  label,
  value,
  min,
  max,
  granularity = 'date',
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  granularity?: 'date' | 'month';
  onChange: (next: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isMonth = granularity === 'month';
  const display = isMonth ? monthLabel(value) : periodLabel(value);
  const fallback = currentPeriodTo();
  const cap = max ?? fallback;
  return (
    <div className="mg-rf-month" data-focus-shell data-granularity={granularity}>
      <button
        type="button"
        onClick={() => {
          const input = inputRef.current;
          if (!input) return;
          try {
            input.showPicker();
          } catch {
            input.focus();
            input.click();
          }
        }}
        aria-label={
          isMonth
            ? `Choose ${label.toLowerCase()}, currently ${display}`
            : `Choose ${label.toLowerCase()} date, currently ${display}`
        }
        aria-haspopup="dialog"
      >
        <CalendarDays size={15} />
        <span className="mg-rf-month-copy">
          <small>{label}</small>
          <strong>{display}</strong>
        </span>
        <ChevronRight className="mg-rf-month-chevron" size={14} aria-hidden="true" />
      </button>
      <input
        ref={inputRef}
        type={isMonth ? 'month' : 'date'}
        value={isMonth ? value.slice(0, 7) : value}
        min={isMonth ? min?.slice(0, 7) : min}
        max={isMonth ? cap.slice(0, 7) : cap}
        onChange={(event) => {
          const next = event.target.value;
          if (isMonth) {
            onChange(next ? `${next}-01` : `${fallback.slice(0, 7)}-01`);
            return;
          }
          onChange(next || fallback);
        }}
        aria-label={isMonth ? label : `${label} date`}
        tabIndex={-1}
      />
    </div>
  );
}
