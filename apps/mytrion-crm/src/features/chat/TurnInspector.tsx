import { useEffect, useRef } from 'react';
import {
  Activity,
  Bot,
  BrainCircuit,
  CheckCircle2,
  CircleDot,
  Database,
  GitBranch,
  ShieldCheck,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import type { TurnTraceEvent } from '../../api/stream';
import type { TurnInspection } from './useChat';
import styles from './TurnInspector.module.css';

function stageIcon(step: TurnTraceEvent) {
  const props = { size: 14, 'aria-hidden': true } as const;
  if (step.status === 'error') return <TriangleAlert {...props} />;
  switch (step.stage) {
    case 'route': return <GitBranch {...props} />;
    case 'model': return <BrainCircuit {...props} />;
    case 'agent': return <Bot {...props} />;
    case 'rag': return <Database {...props} />;
    case 'tool': return <Wrench {...props} />;
    case 'verification': return <ShieldCheck {...props} />;
    case 'complete': return <CheckCircle2 {...props} />;
    default: return <CircleDot {...props} />;
  }
}

function elapsed(start: string, at?: string): string {
  if (!at) return '';
  const ms = Math.max(0, Date.parse(at) - Date.parse(start));
  return ms < 1_000 ? `+${ms}ms` : `+${(ms / 1_000).toFixed(1)}s`;
}

function formatDetail(value: string | number | boolean | null): string {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(4);
  return value ?? '—';
}

function Summary({ inspection }: { inspection: TurnInspection }) {
  const rag = inspection.ragUsed === true ? 'Used' : inspection.ragUsed === false ? 'Not used' : 'Pending';
  return (
    <div className={styles.summary}>
      <div className={styles.summaryItem}>
        <span>Agent</span>
        <strong>{inspection.agent ?? 'Resolving…'}</strong>
      </div>
      <div className={styles.summaryItem}>
        <span>Model</span>
        <strong className={styles.modelValue} title={inspection.model}>{inspection.model ?? 'Waiting…'}</strong>
        {inspection.modelRole && <small>{inspection.modelRole} · {inspection.provider ?? 'provider pending'}</small>}
      </div>
      <div className={styles.summaryItem}>
        <span>RAG</span>
        <strong className={inspection.ragUsed ? styles.ragOn : undefined}>{rag}</strong>
        <small>{inspection.route ?? 'route pending'}{inspection.ragGrade ? ` · ${inspection.ragGrade}` : ''}</small>
      </div>
      <div className={styles.summaryItem}>
        <span>Evidence</span>
        <strong>{inspection.passages ?? 0} passages</strong>
        {inspection.confidence !== undefined && <small>{Math.round(inspection.confidence * 100)}% confidence</small>}
      </div>
    </div>
  );
}

export function TurnInspector({ inspection }: { inspection: TurnInspection | null }) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [inspection?.steps.length]);

  return (
    <aside className={styles.inspector} aria-label="Turn Inspector">
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}><Activity size={13} /> Runtime trace</div>
          <h2>Turn Inspector</h2>
        </div>
        <span className={`${styles.state} ${inspection?.active ? styles.live : ''}`}>
          {inspection?.active ? 'Live' : inspection ? 'Complete' : 'Ready'}
        </span>
      </div>

      {!inspection ? (
        <div className={styles.empty}>
          <BrainCircuit size={28} />
          <strong>Send a Horizon request</strong>
          <p>The agent route, model calls, RAG evidence, tools, and verification steps will appear here.</p>
          <span>Admin diagnostic view · prompts and evidence text are never exposed</span>
        </div>
      ) : (
        <>
          <Summary inspection={inspection} />
          <div className={styles.meta}>
            <span>Run</span>
            <code title={inspection.runId ?? inspection.turnId}>{inspection.runId ?? inspection.turnId}</code>
            {inspection.durationMs !== undefined && <b>{(inspection.durationMs / 1_000).toFixed(2)}s</b>}
          </div>
          <div className={styles.timeline} ref={listRef}>
            {inspection.steps.map((step, index) => (
              <div className={styles.step} key={`${step.at ?? 'local'}-${step.stage}-${index}`}>
                <div className={`${styles.icon} ${styles[step.status]}`}>{stageIcon(step)}</div>
                <div className={styles.stepBody}>
                  <div className={styles.stepHead}>
                    <span>{step.stage}</span>
                    <time>{elapsed(inspection.startedAt, step.at)}</time>
                  </div>
                  <p>{step.label}</p>
                  {step.details && Object.keys(step.details).length > 0 && (
                    <div className={styles.details}>
                      {Object.entries(step.details).map(([key, value]) => (
                        <span key={key}><b>{key}</b> {formatDetail(value)}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
