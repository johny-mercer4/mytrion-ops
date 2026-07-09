import { useState } from 'react';
import { Loader2, RotateCw } from 'lucide-react';

import { ApiError } from '@/api/transport';
import { logAutomation } from '@/api/touchpoints';
import { DetailDialog } from '@/components/mytrion/detail-dialog';
import { Button } from '@/components/ui/button';
import type { Automation } from './data';
import { CarrierPicker } from './automations/CarrierPicker';
import { ResultView } from './automations/ResultView';
import { AUTOMATION_SPECS, type AutomationTarget, type Outcome } from './automations/specs';
import { useToast } from './Toast';

type Phase =
  | { step: 'idle' }
  | { step: 'running' }
  | { step: 'success'; outcome: Outcome }
  | { step: 'error'; message: string };

/**
 * Automation runner modal — picks a real client (DWH directory), collects the spec's
 * inputs, runs the touchpoint flow, and renders the outcome inline. Success stays open
 * (footer flips to Run again / Close) and fires the widget-parity usage log.
 */
export function AutomationModal({ automation, onClose }: { automation: Automation; onClose: () => void }) {
  const { push } = useToast();
  const spec = AUTOMATION_SPECS[automation.id];
  const [phase, setPhase] = useState<Phase>({ step: 'idle' });
  const [target, setTarget] = useState<AutomationTarget | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});

  const running = phase.step === 'running';
  const requiredFieldsMissing = (spec?.fields ?? []).some((f) => f.required && !fields[f.key]?.trim());
  const needsTarget = spec !== undefined && automation.id !== 'efs-login';
  const canRun =
    spec !== undefined && !running && (!needsTarget || target !== null) && !requiredFieldsMissing;

  async function runAction() {
    if (!spec || (needsTarget && !target)) return;
    setPhase({ step: 'running' });
    try {
      const outcome = await spec.run(target ?? { carrierId: null, applicationId: null, companyName: '' }, {
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        fields,
      });
      setPhase({ step: 'success', outcome });
      logAutomation(automation.id);
      push('success', `${automation.title} completed${target ? ` for ${target.companyName}` : ''}.`);
    } catch (err) {
      const message =
        err instanceof ApiError || err instanceof Error ? err.message : 'The action failed — try again.';
      setPhase({ step: 'error', message });
    }
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
            <span key={c} className="rounded-md border bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-bold text-secondary-foreground">
              {c}
            </span>
          ))}
        </>
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={running}>
            {phase.step === 'success' ? 'Close' : 'Cancel'}
          </Button>
          <Button onClick={() => void runAction()} disabled={!canRun}>
            {running ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Running…
              </>
            ) : phase.step === 'success' ? (
              <>
                <RotateCw className="size-4" />
                Run again
              </>
            ) : (
              'Run Action'
            )}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{automation.desc}</p>

        {spec === undefined ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            This automation isn't wired up yet.
          </p>
        ) : null}

        {needsTarget ? (
          <Field label="Client">
            <CarrierPicker
              value={target}
              onChange={(t) => {
                setTarget(t);
                setPhase({ step: 'idle' });
              }}
              needsApplicationId={spec?.needsApplicationId ?? false}
            />
          </Field>
        ) : null}

        {automation.showRange ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
            </Field>
            <Field label="To">
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
            </Field>
          </div>
        ) : null}

        {(spec?.fields ?? []).map((f) => (
          <Field key={f.key} label={f.required ? f.label : `${f.label} (optional)`}>
            <input
              value={fields[f.key] ?? ''}
              onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              className={inputCls}
            />
          </Field>
        ))}

        {automation.procedure ? (
          <div>
            <div className="mb-1.5 text-xs font-semibold text-muted-foreground">Procedure</div>
            <div className="whitespace-pre-line rounded-md border border-primary/24 bg-primary/8 p-3.5 text-xs leading-relaxed text-foreground">
              {automation.procedure}
            </div>
          </div>
        ) : null}

        {phase.step === 'error' ? (
          <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {phase.message}
          </div>
        ) : null}

        {phase.step === 'success' ? <ResultView outcome={phase.outcome} /> : null}
      </div>
    </DetailDialog>
  );
}

const inputCls =
  'w-full rounded-md border bg-muted/40 px-3 py-2 text-sm outline-none focus:border-primary/55 focus:ring-3 focus:ring-primary/12';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
