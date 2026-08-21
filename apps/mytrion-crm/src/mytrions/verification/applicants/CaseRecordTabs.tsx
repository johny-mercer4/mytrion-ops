/**
 * Record chrome on the open case — Case (the 10-phase rail) and Data Center (vendor search).
 *
 * Own module so CaseView does not grow another panel. `ds/Tabs` is the house tab chrome; glass
 * stays on this strip, not on the Data Center results.
 */
import { Tabs } from '@/ds';

export type CaseRecordTab = 'case' | 'data-center';

const ITEMS = [
  { value: 'case', label: 'Case' },
  { value: 'data-center', label: 'Data Center' },
];

export function CaseRecordTabs({
  value,
  onChange,
}: {
  value: CaseRecordTab;
  onChange: (next: CaseRecordTab) => void;
}) {
  return (
    <div className="va-record-tabs">
      <Tabs
        items={ITEMS}
        value={value}
        onValueChange={(next) => onChange(next as CaseRecordTab)}
        variant="line"
        size="sm"
        aria-label="Case record"
      />
    </div>
  );
}
