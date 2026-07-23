import type { AdminDeal, OwnerTimelineChange } from '../../api/adminDeals';
import type { AgentUser } from '../../api/agents';
import { adminToast } from './toast';
import { copyText, dash, relativeTime } from './dealsHelpers';
import s from './admin.module.css';

export interface PriorOwnerState {
  zohoUserId: string | null;
  name: string | null;
  change: OwnerTimelineChange | null;
}

interface Props {
  selected: AdminDeal | null;
  priorOwner: PriorOwnerState | null;
  filteredAgents: AgentUser[];
  agentQuery: string;
  toAgentId: string;
  selectedAgent: AgentUser | null;
  detailLoading: boolean;
  canTransfer: boolean;
  lastTransfer: { deal: boolean; contact: boolean; account: boolean } | null;
  onAgentQueryChange: (value: string) => void;
  onToAgentChange: (zohoUserId: string) => void;
  onUsePrior: () => void;
  onConfirmTransfer: () => void;
}

export function DealTransferDrawer({
  selected,
  priorOwner,
  filteredAgents,
  agentQuery,
  toAgentId,
  selectedAgent,
  detailLoading,
  canTransfer,
  lastTransfer,
  onAgentQueryChange,
  onToAgentChange,
  onUsePrior,
  onConfirmTransfer,
}: Props) {
  return (
    <aside
      className={`${s.dealsDrawer}${detailLoading ? ` ${s.dealsDrawerBusy}` : ''}`}
      aria-label="Deal ownership"
      aria-busy={detailLoading}
    >
      {!selected ? (
        <div className={s.dealsDrawerEmpty}>
          <div className={s.eyebrow}>Transfer panel</div>
          <p className={s.sub} style={{ margin: 0 }}>
            Select a deal to review ownership and transfer Deal + Contact + Company.
          </p>
        </div>
      ) : (
        <>
          <div className={s.dealsDrawerHead}>
            <div>
              <div className={s.eyebrow}>Selected deal</div>
              <h3 className={s.drawerTitle}>{dash(selected.dealName)}</h3>
            </div>
            <button
              type="button"
              className={s.ghostBtn}
              onClick={() => {
                void copyText(selected.id).then((ok) =>
                  ok ? adminToast.success('Deal id copied') : adminToast.error('Copy failed'),
                );
              }}
            >
              Copy id
            </button>
          </div>

          <div className={s.dealsFlow}>
            <div className={s.dealsFlowCard}>
              <span className={s.dealsFlowLabel}>Current</span>
              <strong>{dash(selected.ownerName)}</strong>
            </div>
            <span className={s.dealsFlowArrow} aria-hidden>
              →
            </span>
            <div className={`${s.dealsFlowCard} ${priorOwner?.name ? s.dealsFlowTarget : ''}`}>
              <span className={s.dealsFlowLabel}>
                {priorOwner?.name ? 'Return to' : 'Transfer to'}
              </span>
              <strong>{dash(selectedAgent?.name ?? priorOwner?.name ?? 'Pick agent')}</strong>
            </div>
          </div>

          <dl className={s.metaList}>
            <div>
              <dt>Company</dt>
              <dd>{dash(selected.accountName)}</dd>
            </div>
            <div>
              <dt>Contact</dt>
              <dd>{dash(selected.contactName)}</dd>
            </div>
            {priorOwner?.change ? (
              <div>
                <dt>Timeline</dt>
                <dd>
                  {dash(priorOwner.change.previousOwnerName)} →{' '}
                  {dash(priorOwner.change.newOwnerName)}
                  <span className={s.jobDesc}>
                    {dash(priorOwner.change.transferrerName)} ·{' '}
                    {relativeTime(priorOwner.change.auditedTime)}
                  </span>
                </dd>
              </div>
            ) : null}
          </dl>

          {lastTransfer ? (
            <div className={s.dealsTransferResult} role="status">
              <span className={lastTransfer.deal ? s.badgeGood : s.badgeWarn}>Deal</span>
              <span className={lastTransfer.contact ? s.badgeGood : s.badgeWarn}>Contact</span>
              <span className={lastTransfer.account ? s.badgeGood : s.badgeWarn}>Company</span>
            </div>
          ) : null}

          <label className={s.fieldLabel} htmlFor="admin-deal-agent-filter">
            Find agent
          </label>
          <input
            id="admin-deal-agent-filter"
            className={s.input}
            value={agentQuery}
            onChange={(e) => onAgentQueryChange(e.target.value)}
            placeholder="Filter by name, email, profile…"
            aria-label="Filter agents"
          />

          <label
            className={s.fieldLabel}
            htmlFor="admin-deal-agent"
            style={{ marginTop: 'var(--space-3)' }}
          >
            Transfer to
          </label>
          <select
            id="admin-deal-agent"
            className={s.input}
            value={toAgentId}
            onChange={(e) => onToAgentChange(e.target.value)}
          >
            <option value="">Select agent…</option>
            {filteredAgents.map((a) => (
              <option key={a.zohoUserId} value={a.zohoUserId}>
                {a.name ?? a.zohoUserId}
                {priorOwner?.zohoUserId === a.zohoUserId ? ' · prior' : ''}
                {a.profile ? ` · ${a.profile}` : ''}
              </option>
            ))}
          </select>

          {priorOwner?.zohoUserId ? (
            <button
              type="button"
              className={s.ghostBtn}
              style={{ marginTop: 'var(--space-2)', width: '100%' }}
              onClick={onUsePrior}
            >
              Use timeline prior · {dash(priorOwner.name)}
            </button>
          ) : null}

          <button
            type="button"
            className={`${s.primaryBtn} ${s.tall}`}
            style={{ marginTop: 'var(--space-4)', width: '100%' }}
            disabled={!canTransfer}
            onClick={onConfirmTransfer}
          >
            Transfer Deal + Contact + Company
          </button>
        </>
      )}
    </aside>
  );
}
