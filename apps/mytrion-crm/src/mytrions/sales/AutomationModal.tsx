import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { DetailDialog } from '@/components/mytrion/detail-dialog';
import { Button } from '@/components/ui/button';
import type { Automation } from './data';
import { useToast } from './Toast';

const DEMO_CARRIER = 'Great Way Logistics Inc #98765';

export function AutomationModal({ automation, onClose }: { automation: Automation; onClose: () => void }) {
  const { push } = useToast();
  const [running, setRunning] = useState(false);
  const [from, setFrom] = useState('2025-06-01');
  const [to, setTo] = useState('2025-06-30');

  function runAction() {
    setRunning(true);
    window.setTimeout(() => {
      setRunning(false);
      onClose();
      push('success', `${automation.title} completed for Great Way Logistics Inc.`);
    }, 1700);
  }

  return (
    <DetailDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={automation.title}
      size="md"
      badges={
        <>
          {automation.codes.map((c) => (
            <span key={c} className="rounded-xs border bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-bold text-secondary-foreground">
              {c}
            </span>
          ))}
        </>
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={running}>
            Cancel
          </Button>
          <Button onClick={runAction} disabled={running}>
            {running ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Running…
              </>
            ) : (
              'Run Action'
            )}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <p className="text-sm text-muted-foreground">{automation.desc}</p>

        <Field label="Carrier">
          <div className="rounded-xs border bg-muted/40 px-3 py-2 text-sm font-semibold">{DEMO_CARRIER}</div>
        </Field>

        {automation.showRange ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full rounded-xs border bg-muted/40 px-3 py-2 text-sm outline-none focus:border-primary/55 focus:ring-3 focus:ring-primary/12"
              />
            </Field>
            <Field label="To">
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full rounded-xs border bg-muted/40 px-3 py-2 text-sm outline-none focus:border-primary/55 focus:ring-3 focus:ring-primary/12"
              />
            </Field>
          </div>
        ) : null}

        {automation.procedure ? (
          <div>
            <div className="mb-1.5 text-xs font-semibold text-muted-foreground">Procedure</div>
            <div className="whitespace-pre-line rounded-xs border border-primary/24 bg-primary/8 p-3.5 text-xs leading-relaxed text-foreground">
              {automation.procedure}
            </div>
          </div>
        ) : null}
      </div>
    </DetailDialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
