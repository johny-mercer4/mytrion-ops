import { useRef } from 'react';
import { CalendarDays, ChevronRight } from 'lucide-react';
import { currentPeriod, periodLabel } from './referralPeriod';

export function ReferralMonthField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (next: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="mg-rf-month" data-focus-shell>
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
        aria-label={`Choose ${label.toLowerCase()} month, currently ${periodLabel(value)}`}
        aria-haspopup="dialog"
      >
        <CalendarDays size={15} />
        <span className="mg-rf-month-copy">
          <small>{label}</small>
          <strong>{periodLabel(value)}</strong>
        </span>
        <ChevronRight className="mg-rf-month-chevron" size={14} aria-hidden="true" />
      </button>
      <input
        ref={inputRef}
        type="month"
        value={value.slice(0, 7)}
        min={min?.slice(0, 7)}
        max={(max ?? currentPeriod()).slice(0, 7)}
        onChange={(event) =>
          onChange(event.target.value ? `${event.target.value}-01` : currentPeriod())
        }
        aria-label={`${label} month`}
        tabIndex={-1}
      />
    </div>
  );
}
