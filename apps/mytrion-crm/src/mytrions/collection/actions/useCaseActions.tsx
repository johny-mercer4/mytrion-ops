/**
 * One place that owns "which write dialog is open, and on which case".
 *
 * FOUR surfaces open these dialogs — the worklist row, the case record's Do next rail, the case
 * list's row menu, and the placement queue. Without this hook each would hold four booleans and a
 * target, and the fourth one to be written would be the one that forgets to refresh the list
 * afterwards. `onDone` is the single refresh seam.
 */
import { useState } from 'react';
import type { CollectionCaseRow } from '@/api/collection';
import type { PaymentPlan, PlacementRow } from '@/api/collectionDesk';
import { CloseCaseDialog } from './CloseCaseDialog';
import { LogContactDialog } from './LogContactDialog';
import { PaymentPlanDialog } from './PaymentPlanDialog';
import { PlacementDialog } from './PlacementDialog';
import './actions.css';

type ActionKind = 'contact' | 'plan' | 'placement' | 'close';

interface OpenState {
  kind: ActionKind;
  row: CollectionCaseRow;
  /** Only the plan dialog needs it, and only to say what it is replacing. */
  plan: PaymentPlan | null;
  /** Only the placement dialog needs it, and only when the caller has the queue's verdict. */
  placement: PlacementRow | null;
}

export interface CaseActions {
  openContact: (row: CollectionCaseRow) => void;
  openPlan: (row: CollectionCaseRow, existing?: PaymentPlan | null) => void;
  openPlacement: (row: CollectionCaseRow, placement?: PlacementRow | null) => void;
  openClose: (row: CollectionCaseRow) => void;
  dismiss: () => void;
  state: OpenState | null;
  onDone: () => void;
}

export function useCaseActions({ onDone }: { onDone: () => void }): CaseActions {
  const [state, setState] = useState<OpenState | null>(null);
  const open = (kind: ActionKind, row: CollectionCaseRow, extra: Partial<OpenState> = {}): void => {
    setState({ kind, row, plan: null, placement: null, ...extra });
  };
  return {
    openContact: (row) => open('contact', row),
    openPlan: (row, existing = null) => open('plan', row, { plan: existing }),
    openPlacement: (row, placement = null) => open('placement', row, { placement }),
    openClose: (row) => open('close', row),
    dismiss: () => setState(null),
    state,
    onDone,
  };
}

/**
 * Renders whichever dialog is open. Mount it ONCE per surface, at the end of the tree.
 *
 * Keyed on the case id so switching target inside an open dialog remounts rather than leaving a
 * half-filled form pointing at a different debt — which is the kind of bug that writes a promise
 * to the wrong carrier.
 */
export function CaseActionDialogs({ actions }: { actions: CaseActions }) {
  const { state, dismiss, onDone } = actions;
  if (!state) return null;
  const shared = { row: state.row, open: true, onClose: dismiss, onDone };
  const key = `${state.kind}:${state.row.id}`;
  switch (state.kind) {
    case 'contact':
      return <LogContactDialog key={key} {...shared} />;
    case 'plan':
      return <PaymentPlanDialog key={key} existing={state.plan} {...shared} />;
    case 'placement':
      return <PlacementDialog key={key} placement={state.placement} {...shared} />;
    case 'close':
      return <CloseCaseDialog key={key} {...shared} />;
    default:
      return null;
  }
}
