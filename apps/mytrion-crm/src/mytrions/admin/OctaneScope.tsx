import { useEffect, useState } from 'react';
import { createRisk, deleteRisk, listRisks, updateRisk, type RiskCategory, type ScopeRiskItem } from '../../api/scope';
import { PlusIcon, ScopeIcon, XIcon } from '../../components/icons';
import s from './admin.module.css';

interface Stage {
  key: string;
  label: string;
  eyebrow: string;
  title: string;
  blueprint: string[];
  routing?: string[];
  departments: { name: string; items: string[] }[];
  automations: string[];
  details: string;
  metrics: string[];
  terminal?: boolean;
}

// TODO(live): sourced from the agent-scope config. Compact port of the mockup's lifecycle map.
const LIFECYCLES: Record<'intake' | 'after', Stage[]> = {
  intake: [
    {
      key: 'leadgen',
      label: 'Lead Gen',
      eyebrow: 'Stage 1',
      title: 'Lead Generation',
      blueprint: ['New lead captured', 'Distribution engine routes', 'Assigned to sales agent'],
      routing: ['Territory', 'Fleet size', 'Fuel volume', 'Agent load'],
      departments: [
        { name: 'Marketing', items: ['Campaign capture', 'Web form intake'] },
        { name: 'Sales', items: ['Lead claim', 'First-touch call'] },
      ],
      automations: ['Auto-assign leads by routing factors', 'Notify agent on new lead'],
      details: 'Inbound leads are captured and routed to the right sales agent by the distribution engine.',
      metrics: ['Leads / day', 'Time-to-first-touch', 'Assignment rate'],
    },
    {
      key: 'leadcycle',
      label: 'Lead Cycle',
      eyebrow: 'Stage 2',
      title: 'Lead Cycle',
      blueprint: ['Qualify', 'Fuel-card demo', 'Proposal sent', 'Decision'],
      departments: [
        { name: 'Sales', items: ['Demo', 'Proposal', 'Follow-up cadence'] },
      ],
      automations: ['Demo reminder tasks', 'Stale-lead nudges'],
      details: 'The agent qualifies the lead, runs a fuel-card demo, and moves it toward a signed deal.',
      metrics: ['Conversion rate', 'Cycle time', 'Demos / week'],
    },
    {
      key: 'wex',
      label: 'WEX',
      eyebrow: 'Stage 3',
      title: 'WEX Application',
      blueprint: ['Submit WEX application', 'Credit decision', 'BOCA / setup tasks'],
      departments: [
        { name: 'Verification', items: ['KYC', 'Credit review'] },
        { name: 'Customer Service', items: ['WEX portal tasks'] },
      ],
      automations: ['Sync WEX application status', 'BOCA link request'],
      details: 'The carrier application is submitted to WEX; verification handles credit and setup.',
      metrics: ['Approval rate', 'Time-to-approval'],
    },
    {
      key: 'deal',
      label: 'Deal',
      eyebrow: 'Stage 4',
      title: 'Deal Closed',
      blueprint: ['Terms set (LOC / prepay)', 'Cards issued', 'Account activated'],
      departments: [
        { name: 'Billing', items: ['Terms + billing cycle'] },
        { name: 'Sales', items: ['Handoff to onboarding'] },
      ],
      automations: ['Card activation workflow', 'Welcome sequence'],
      details: 'Terms are set and cards are issued; the account goes live.',
      metrics: ['Deal value', 'Cards / deal'],
    },
    {
      key: 'client',
      label: 'Client',
      eyebrow: 'Stage 5',
      title: 'Client Stage',
      blueprint: [],
      terminal: true,
      departments: [
        { name: 'Customer Service', items: ['Servicing', 'Tickets'] },
        { name: 'Finance', items: ['Invoicing', 'Collections'] },
      ],
      automations: ['Usage + balance monitoring', 'Debtor sweeps'],
      details: 'The client is live and serviced day-to-day across the operational Mytrions.',
      metrics: ['Retention', 'Monthly fuel spend'],
    },
  ],
  after: [
    {
      key: 'verification',
      label: 'Verification',
      eyebrow: 'Stage 1',
      title: 'Ongoing Verification',
      blueprint: ['Re-check triggers', 'Document refresh', 'Hard-stop review'],
      departments: [{ name: 'Verification', items: ['Recheck reminders', 'Document checklist'] }],
      automations: ['Verification recheck reminders'],
      details: 'Periodic re-verification keeps client records and risk posture current.',
      metrics: ['Recheck completion', 'Hard-stop rate'],
    },
    {
      key: 'retention',
      label: 'Retention',
      eyebrow: 'Stage 2',
      title: 'Retention',
      blueprint: ['Churn signal', 'Win-back play', 'Save or churn'],
      departments: [{ name: 'Retention', items: ['Risk scan', 'Win-back offers'] }],
      automations: ['Weekly churn scan', 'At-risk alerts'],
      details: 'Churn signals trigger win-back plays to keep the client active.',
      metrics: ['Churn rate', 'Save rate'],
    },
  ],
};

const SUBTABS = ['Blueprint', 'Departments', 'Automations', 'Details', 'Risk Items'] as const;
type SubTab = (typeof SUBTABS)[number];

/**
 * Stage key → /v1/scope/risks nodeId. The intake ids match the RnD widget's nodes exactly,
 * so risk items edited here and in the Zoho widget are the SAME records.
 */
const NODE_IDS: Record<string, string> = {
  leadgen: 'lead-generation',
  leadcycle: 'lead-cycle',
  wex: 'wex-cycle',
  deal: 'deal-cycle',
  client: 'client-stage',
  verification: 'after-verification',
  retention: 'after-retention',
};

const RISK_CATEGORIES: Array<{ key: RiskCategory; label: string }> = [
  { key: 'blocker', label: 'Blockers' },
  { key: 'red_flag', label: 'Red Flags' },
  { key: 'manual', label: 'Manual Processes' },
];

/** Admin Octane-Scope — the client lifecycle map (Intake + After), stage by stage. */
export function OctaneScope() {
  const [cycle, setCycle] = useState<'intake' | 'after'>('intake');
  const [stageIdx, setStageIdx] = useState(0);
  const [sub, setSub] = useState<SubTab>('Blueprint');
  const stages = LIFECYCLES[cycle];
  const stage = stages[Math.min(stageIdx, stages.length - 1)]!;

  return (
    <div className={`${s.panel} ${s.panelWide}`}>
      <div className={s.head}>
        <div>
          <h2 className={s.h2}>Octane-Scope</h2>
          <p className={s.sub}>The client lifecycle — every stage, its departments, and its automations.</p>
        </div>
        <div className={s.toggleRow}>
          <button
            type="button"
            className={`${s.toggle} ${cycle === 'intake' ? s.toggleOn : ''}`}
            onClick={() => { setCycle('intake'); setStageIdx(0); }}
          >
            Intake Lifecycle
          </button>
          <button
            type="button"
            className={`${s.toggle} ${cycle === 'after' ? s.toggleOn : ''}`}
            onClick={() => { setCycle('after'); setStageIdx(0); }}
          >
            After Lifecycle
          </button>
        </div>
      </div>

      {/* stepper */}
      <div className={s.stepper}>
        <div className={s.steps}>
          {stages.map((st, i) => (
            <button
              key={st.key}
              type="button"
              className={`${s.step} ${i === stageIdx ? s.stepOn : ''}`}
              onClick={() => { setStageIdx(i); setSub('Blueprint'); }}
            >
              <span className={s.stepCircle}>{i + 1}</span>
              <span className={s.stepLabel}>{st.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* stage detail */}
      <div className={s.card}>
        <div className={s.stageHead}>
          <span className={s.stageIcon}>
            <ScopeIcon size={21} />
          </span>
          <div>
            <div className={s.eyebrow}>{stage.eyebrow}</div>
            <div className={s.stageTitle}>{stage.title}</div>
          </div>
        </div>

        <div className={s.subTabs}>
          {SUBTABS.map((t) => (
            <button
              key={t}
              type="button"
              className={`${s.subTab} ${sub === t ? s.subTabOn : ''}`}
              onClick={() => setSub(t)}
            >
              {t}
            </button>
          ))}
        </div>

        <div className={s.stageBody}>
          {sub === 'Blueprint' &&
            (stage.terminal ? (
              <p className={s.passage}>The client is live and serviced across the operational Mytrions.</p>
            ) : (
              <>
                <div className={s.flow}>
                  {stage.blueprint.map((step, i) => (
                    <div key={i} className={s.flowNode}>
                      {step}
                    </div>
                  ))}
                </div>
                {stage.routing && (
                  <>
                    <div className={s.eyebrow} style={{ marginTop: 'var(--space-4)' }}>
                      Distribution engine · routing factors
                    </div>
                    <div className={s.metricChips}>
                      {stage.routing.map((r) => (
                        <span key={r} className={`${s.pill} ${s.pillInfo}`}>
                          {r}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </>
            ))}

          {sub === 'Departments' && (
            <div className={s.deptGrid}>
              {stage.departments.map((d) => (
                <div key={d.name} className={s.deptCard}>
                  <div className={s.deptName}>
                    <span className={s.dot} style={{ background: 'var(--accent)' }} />
                    {d.name}
                  </div>
                  {d.items.map((it) => (
                    <div key={it} className={s.deptItem}>
                      › {it}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {sub === 'Automations' && (
            <div className={s.autoList}>
              {stage.automations.map((a) => (
                <div key={a} className={s.autoRow}>
                  <span className={s.autoIcon}>
                    <ScopeIcon size={15} />
                  </span>
                  <span className={s.autoText}>{a}</span>
                </div>
              ))}
            </div>
          )}

          {sub === 'Details' && (
            <>
              <p className={s.passage}>{stage.details}</p>
              <div className={s.eyebrow} style={{ marginTop: 'var(--space-4)' }}>
                Tracked metrics
              </div>
              <div className={s.metricChips}>
                {stage.metrics.map((m) => (
                  <span key={m} className={s.metricChip}>
                    {m}
                  </span>
                ))}
              </div>
            </>
          )}

          {sub === 'Risk Items' && <RiskItems nodeId={NODE_IDS[stage.key] ?? stage.key} />}
        </div>
      </div>
    </div>
  );
}

/** Live Blockers / Red Flags / Manual editor for one lifecycle node (/v1/scope/risks). */
function RiskItems({ nodeId }: { nodeId: string }) {
  const [items, setItems] = useState<ScopeRiskItem[] | null>(null);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<RiskCategory, string>>({
    blocker: '',
    red_flag: '',
    manual: '',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setItems(null);
    setError('');
    setDrafts({ blocker: '', red_flag: '', manual: '' });
    listRisks(nodeId)
      .then((res) => alive && setItems(res.items))
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        setItems([]); // stop the perpetual "Loading…" row; the error note explains the failure
      });
    return () => {
      alive = false;
    };
  }, [nodeId]);

  async function add(category: RiskCategory) {
    const label = drafts[category].trim();
    if (!label || busy) return;
    setBusy(true);
    try {
      const res = await createRisk({ nodeId, category, label });
      setItems((prev) => [...(prev ?? []), res.item]);
      setDrafts((d) => ({ ...d, [category]: '' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function rename(item: ScopeRiskItem) {
    const label = window.prompt('Edit item', item.label)?.trim();
    if (!label || label === item.label) return;
    try {
      const res = await updateRisk(item.id, { label });
      setItems((prev) => (prev ?? []).map((x) => (x.id === item.id ? res.item : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove(item: ScopeRiskItem) {
    try {
      await deleteRisk(item.id);
      setItems((prev) => (prev ?? []).filter((x) => x.id !== item.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className={s.deptGrid}>
      {error && (
        <p className={s.errorNote} role="alert" style={{ gridColumn: '1 / -1' }}>
          {error}
        </p>
      )}
      {RISK_CATEGORIES.map(({ key, label }) => {
        const list = (items ?? []).filter((i) => i.category === key);
        return (
          <div key={key} className={s.deptCard}>
            <div className={s.deptName}>
              <span
                className={s.dot}
                style={{
                  background:
                    key === 'blocker' ? 'var(--danger)' : key === 'red_flag' ? 'var(--warning, var(--accent))' : 'var(--accent)',
                }}
              />
              {label}
            </div>
            {items === null && <div className={s.deptItem}>Loading…</div>}
            {list.map((item) => (
              <div key={item.id} className={s.riskRow}>
                <button type="button" className={s.riskLabel} onClick={() => void rename(item)} title="Click to edit">
                  {item.label}
                </button>
                <button type="button" className={s.iconBtn} aria-label={`Delete ${item.label}`} onClick={() => void remove(item)}>
                  <XIcon size={10} />
                </button>
              </div>
            ))}
            {items !== null && list.length === 0 && <div className={s.deptItem}>None recorded.</div>}
            <div className={s.inlineRow}>
              <input
                className={s.input}
                value={drafts[key]}
                onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && void add(key)}
                placeholder={`Add ${label.toLowerCase().replace(/s$/, '')}…`}
              />
              <button type="button" className={s.miniBtn} disabled={busy || !drafts[key].trim()} onClick={() => void add(key)}>
                <PlusIcon size={11} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
