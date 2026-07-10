import { useState } from 'react';
import { Check } from 'lucide-react';

import { DetailDialog } from '@/components/mytrion/detail-dialog';
import { StatusBadge, type StatusTone } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import {
  HARD_STOPS,
  POLICY,
  baseLOC,
  fmtCurrency,
  initials,
  type Application,
  type PassTone,
} from './data';

type Decision = 'loc' | 'prepay' | 'wex';
type Tier = 'weak' | 'moderate' | 'strong';
type Cycle = '1-week' | '2-week';

const PASS_TONE: Record<PassTone, StatusTone> = { pass: 'good', watch: 'warn', stop: 'bad' };
const PASS_LABEL: Record<PassTone, string> = { pass: 'PASS', watch: 'WATCH', stop: 'STOP' };

const STEP_LABELS = ['Carrier Lookup', 'Financial', 'Credit', 'Limit & Decision'];

export interface ToastFn {
  (kind: 'success' | 'info' | 'error', message: string): void;
}

export function ApplicationModal({
  app,
  onClose,
  onDecision,
  onRequestDocs,
}: {
  app: Application;
  onClose: () => void;
  onDecision: (app: Application, label: string) => void;
  onRequestDocs: (app: Application) => void;
}) {
  const defaultDecision: Decision =
    app.kind === 'new' && app.status === 'WEX Routing' ? 'wex' : app.kind === 'new' && app.status === 'Prepay Only' ? 'prepay' : 'loc';
  const [decision, setDecision] = useState<Decision>(defaultDecision);
  const [tier, setTier] = useState<Tier>('moderate');
  const [cycle, setCycle] = useState<Cycle>('2-week');

  const statusTone: StatusTone =
    app.status === 'Ready for Decision' ? 'good' : app.status === 'Prepay Only' ? 'warn' : app.status === 'Pending Docs' ? 'warn' : 'info';

  const subtitle =
    app.kind === 'new'
      ? `Carrier ${app.carrierId} · ${app.mc} · ${app.dot}`
      : `Carrier ${app.carrierId} · ${app.reqType} · ${app.tenure}`;

  function recordDecision() {
    let label: string;
    if (decision === 'wex') label = 'Routed to WEX application';
    else if (decision === 'prepay') label = 'Prepay / Deposit 1:1';
    else label = `LOC · ${tier[0]?.toUpperCase()}${tier.slice(1)} · ${cycle}`;
    onDecision(app, label);
  }

  return (
    <DetailDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={app.company}
      subtitle={subtitle}
      size="xl"
      badges={<StatusBadge tone={statusTone}>{app.status}</StatusBadge>}
      footer={
        <>
          <Button variant="outline" onClick={() => onRequestDocs(app)}>
            Request Documents
          </Button>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={recordDecision}>Record Decision</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3.5 py-2.5">
          <div className="flex items-center gap-2 text-sm">
            <span className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
              {initials(app.agent)}
            </span>
            <span className="text-muted-foreground">Sales agent owner ·</span>
            <span className="font-semibold">{app.agent}</span>
          </div>
        </div>

        {app.kind === 'new' ? (
          <NewApplicationBody app={app} decision={decision} setDecision={setDecision} tier={tier} setTier={setTier} cycle={cycle} setCycle={setCycle} />
        ) : (
          <ClientRequestBody req={app} />
        )}
      </div>
    </DetailDialog>
  );
}

// ---- 'new' kind ----

function NewApplicationBody({
  app,
  decision,
  setDecision,
  tier,
  setTier,
  cycle,
  setCycle,
}: {
  app: Extract<Application, { kind: 'new' }>;
  decision: Decision;
  setDecision: (d: Decision) => void;
  tier: Tier;
  setTier: (t: Tier) => void;
  cycle: Cycle;
  setCycle: (c: Cycle) => void;
}) {
  const loc = baseLOC(app.calc.income, app.calc.expenses, app.calc.fuel);
  const financialChecks = getFinancialChecks(app);
  const allChecksPassed = financialChecks.every((c) => c.tone === 'pass');
  const suggestion = app.cards >= POLICY.wexCardThreshold ? 'Route to WEX application' : allChecksPassed ? `LOC · limit ${fmtCurrency(loc)}` : 'Prepay / Deposit 1:1';

  return (
    <>
      <StepTracker current={app.step} />

      <section>
        <SectionTitle>Step 1 · Carrier Lookup</SectionTitle>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <VendorCard title="FMCSA">
            <CheckRow label="Authority" tone={app.fmcsa.authority === 'Active' ? 'pass' : 'stop'} value={app.fmcsa.authority} />
            <CheckRow label="Insurance" tone={app.fmcsa.insurance === 'Active' ? 'pass' : 'stop'} value={app.fmcsa.insurance} />
            <CheckRow label="Fleet" tone={null} value={`${app.fmcsa.fleet} trucks`} />
            <CheckRow label="MC granted" tone={null} value={String(app.fmcsa.granted)} />
          </VendorCard>
          <VendorCard title="Highway">
            <CheckRow
              label="Risk score"
              tone={app.highway === 'Low' ? 'pass' : app.highway === 'Medium' ? 'watch' : 'stop'}
              value={app.highway}
            />
            <CheckRow label="Affiliates" tone="pass" value="None flagged" />
          </VendorCard>
          <VendorCard title="CreditSafe">
            <CheckRow
              label="Profile"
              tone={app.credit === 'Low Risk' ? 'pass' : app.credit === 'Thin File' ? 'watch' : 'stop'}
              value={app.credit}
            />
            <CheckRow label="Liens" tone="pass" value="None" />
          </VendorCard>
        </div>
      </section>

      <section>
        <SectionTitle>Step 2 · Financial Hard-Stops</SectionTitle>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-5">
          {financialChecks.map((c) => (
            <MiniCheckCard key={c.label} label={c.label} tone={c.tone} value={c.value} hint={c.hint} />
          ))}
        </div>
      </section>

      {app.docs.length > 0 ? (
        <div className="rounded-md border border-warn/30 bg-warn/8 p-3.5">
          <div className="mb-2 text-xs font-bold text-warn">Documents required from client (72h SLA)</div>
          <div className="flex flex-wrap gap-1.5">
            {app.docs.map((d) => (
              <span key={d} className="rounded-md border bg-card px-2 py-1 text-[11px] font-medium">
                {d}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <section>
        <SectionTitle>Step 4 · Cash-Flow Limit</SectionTitle>
        <CashFlowStrip income={app.calc.income} expenses={app.calc.expenses} fuel={app.calc.fuel} loc={loc} />
        <div className="mt-2 text-xs text-muted-foreground">
          Card routing: <b className="text-foreground">{app.cards >= POLICY.wexCardThreshold ? 'WEX-funded (21+ cards)' : 'Octane internal (1–20 cards)'}</b>
          {' · Suggested: '}
          <b className="text-foreground">{suggestion}</b>
        </div>
      </section>

      <DecisionPanel loc={loc} decision={decision} setDecision={setDecision} tier={tier} setTier={setTier} cycle={cycle} setCycle={setCycle} />
    </>
  );
}

function getFinancialChecks(app: Extract<Application, { kind: 'new' }>) {
  return [
    {
      label: 'Avg weekly income',
      tone: (app.fin.weeklyIncome >= HARD_STOPS.minWeeklyIncome ? 'pass' : 'stop') as PassTone,
      value: fmtCurrency(app.fin.weeklyIncome),
      hint: 'min $3,000',
    },
    {
      label: 'Average daily balance',
      tone: (app.fin.adb >= HARD_STOPS.minAvgDailyBalance ? 'pass' : 'stop') as PassTone,
      value: fmtCurrency(app.fin.adb),
      hint: 'min $500',
    },
    {
      label: 'Overdrafts',
      tone: (app.fin.overdrafts < HARD_STOPS.maxOverdrafts + 1 ? 'pass' : 'stop') as PassTone,
      value: String(app.fin.overdrafts),
      hint: 'max 3',
    },
    {
      label: 'ACH/NSF returns',
      tone: (app.fin.nsf < HARD_STOPS.maxAchNsf + 1 ? 'pass' : 'stop') as PassTone,
      value: String(app.fin.nsf),
      hint: 'max 1',
    },
    {
      label: 'Income type',
      tone: (app.fin.weeklyIncome > 0 ? 'pass' : 'stop') as PassTone,
      value: app.fin.incomeType,
      hint: 'trucking only',
    },
  ];
}

// ---- 'req' kind ----

function ClientRequestBody({ req }: { req: Extract<Application, { kind: 'req' }> }) {
  const loc = baseLOC(req.calc.income, req.calc.expenses, req.calc.fuel);
  const cappedLimit = Math.min(loc, req.currentLimit + POLICY.limitIncreaseCap);
  const hasRecalc = req.calc.income > 0;

  const eligChecks: { label: string; tone: PassTone; value: string; hint: string }[] = [
    {
      label: 'Paid invoices',
      tone: req.elig.paidInvoices >= POLICY.minPaidInvoices ? 'pass' : 'stop',
      value: String(req.elig.paidInvoices),
      hint: 'min 5',
    },
    {
      label: 'Active insurance',
      tone: req.elig.insurance === 'Active' ? 'pass' : 'stop',
      value: req.elig.insurance,
      hint: 'required',
    },
    {
      label: 'Late payments',
      tone: req.elig.latePayments <= POLICY.maxLatePayments ? 'pass' : 'stop',
      value: String(req.elig.latePayments),
      hint: 'max 10',
    },
  ];

  return (
    <>
      <div className="rounded-md border bg-muted/30 p-3.5 text-sm">{req.detail}</div>

      <section>
        <div className="mb-2.5 flex items-center justify-between">
          <SectionTitle noMargin>Eligibility Check</SectionTitle>
          <span className="font-mono text-xs text-muted-foreground">Current limit {fmtCurrency(req.currentLimit)}</span>
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {eligChecks.map((c) => (
            <MiniCheckCard key={c.label} label={c.label} tone={c.tone} value={c.value} hint={c.hint} />
          ))}
        </div>
      </section>

      {hasRecalc ? (
        <section>
          <SectionTitle>Recalculated Limit (fresh financials)</SectionTitle>
          <CashFlowStrip income={req.calc.income} expenses={req.calc.expenses} fuel={req.calc.fuel} loc={loc} />
          <div className="mt-2 text-xs text-muted-foreground">
            New limit capped at +$5,000 per cycle — <b className="text-foreground">{fmtCurrency(cappedLimit)}</b>
          </div>
        </section>
      ) : null}
    </>
  );
}

// ---- shared pieces ----

function StepTracker({ current }: { current: number }) {
  return (
    <div className="flex items-center">
      {STEP_LABELS.map((label, i) => {
        const stepNum = i + 1;
        const done = stepNum < current;
        const isCurrent = stepNum === current;
        return (
          <div key={label} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <span
                className={`flex size-7 items-center justify-center rounded-full text-xs font-bold ${
                  done ? 'bg-good text-white' : isCurrent ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                }`}
              >
                {done ? <Check className="size-3.5" /> : stepNum}
              </span>
              <span className={`text-center text-[10px] font-semibold ${isCurrent ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</span>
            </div>
            {stepNum < STEP_LABELS.length ? <span className={`mx-1.5 h-px flex-1 ${done ? 'bg-good' : 'bg-border'}`} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function VendorCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="mb-2 text-xs font-bold text-primary">{title}</div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function CheckRow({ label, tone, value }: { label: string; tone: PassTone | null; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="font-medium">{value}</span>
        {tone ? <StatusBadge tone={PASS_TONE[tone]}>{PASS_LABEL[tone]}</StatusBadge> : null}
      </div>
    </div>
  );
}

function MiniCheckCard({ label, tone, value, hint }: { label: string; tone: PassTone; value: string; hint: string }) {
  return (
    <div className="rounded-md border bg-card p-2.5">
      <div className="mb-1 flex items-center justify-between gap-1">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase">{label}</span>
        <StatusBadge tone={tone === 'pass' ? 'good' : 'bad'}>{tone === 'pass' ? 'PASS' : 'STOP'}</StatusBadge>
      </div>
      <div className="text-sm font-bold">{value}</div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>
    </div>
  );
}

function CashFlowStrip({ income, expenses, fuel, loc }: { income: number; expenses: number; fuel: number; loc: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3">
      <FormulaChip label="Weekly Income" value={fmtCurrency(income)} tone="good" />
      <span className="text-muted-foreground">−</span>
      <FormulaChip label="Weekly Expenses" value={fmtCurrency(expenses)} tone="bad" />
      <span className="text-muted-foreground">+</span>
      <FormulaChip label="Weekly Fuel" value={fmtCurrency(fuel)} tone="warn" />
      <span className="text-muted-foreground">=</span>
      <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5">
        <div className="text-[10px] font-semibold text-primary uppercase">Base LOC</div>
        <div className="font-mono text-sm font-bold text-primary">{fmtCurrency(loc)}</div>
      </div>
    </div>
  );
}

function FormulaChip({ label, value, tone }: { label: string; value: string; tone: 'good' | 'bad' | 'warn' }) {
  const toneClass = { good: 'text-good', bad: 'text-bad', warn: 'text-warn' }[tone];
  return (
    <div className="rounded-md border bg-card px-2.5 py-1.5">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase">{label}</div>
      <div className={`font-mono text-sm font-bold ${toneClass}`}>{value}</div>
    </div>
  );
}

function DecisionPanel({
  loc,
  decision,
  setDecision,
  tier,
  setTier,
  cycle,
  setCycle,
}: {
  loc: number;
  decision: Decision;
  setDecision: (d: Decision) => void;
  tier: Tier;
  setTier: (t: Tier) => void;
  cycle: Cycle;
  setCycle: (c: Cycle) => void;
}) {
  return (
    <section>
      <SectionTitle>Decision</SectionTitle>
      <div className="flex flex-col gap-3 rounded-md border bg-card p-3.5">
        <ToggleRow
          value={decision}
          onChange={(v) => setDecision(v as Decision)}
          options={[
            { id: 'loc', label: 'LOC' },
            { id: 'prepay', label: 'Prepay / Deposit 1:1' },
            { id: 'wex', label: 'Route to WEX' },
          ]}
        />
        {decision === 'loc' ? (
          <>
            <div>
              <div className="mb-1.5 text-[10px] font-semibold text-muted-foreground uppercase">Tier</div>
              <ToggleRow
                value={tier}
                onChange={(v) => setTier(v as Tier)}
                options={[
                  { id: 'weak', label: 'Weak' },
                  { id: 'moderate', label: 'Moderate' },
                  { id: 'strong', label: 'Strong' },
                ]}
              />
            </div>
            <div>
              <div className="mb-1.5 text-[10px] font-semibold text-muted-foreground uppercase">Billing Cycle</div>
              <ToggleRow
                value={cycle}
                onChange={(v) => setCycle(v as Cycle)}
                options={[
                  { id: '1-week', label: '1-week' },
                  { id: '2-week', label: '2-week' },
                ]}
              />
            </div>
            <div className="flex items-center justify-between border-t pt-2.5 text-sm">
              <span className="text-muted-foreground">Approved spending limit</span>
              <span className="font-mono font-bold text-primary">{fmtCurrency(loc)}</span>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function ToggleRow({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
              active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function SectionTitle({ children, noMargin }: { children: React.ReactNode; noMargin?: boolean }) {
  return (
    <div className={`font-heading ${noMargin ? '' : 'mb-2.5'} text-xs font-bold tracking-wide text-primary uppercase`}>
      {children}
    </div>
  );
}
