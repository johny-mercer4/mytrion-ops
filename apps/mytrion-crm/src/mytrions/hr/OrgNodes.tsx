/**
 * The two org-canvas node views: a department and a person.
 *
 * Both carry a target handle on top and a source handle on the bottom, which is what makes the chart
 * top-to-bottom AND connectable by hand — dragging from a bottom handle onto another node's top handle
 * re-parents, exactly like dropping the node itself. Same node contract as the Scope blueprint
 * (`admin/scope/Blueprint.tsx`).
 *
 * A node has four affordances, and they must not collide:
 *   the body      → opens the record (single click — handled on the canvas via onNodeClick)
 *   the "open"    → the same, for the keyboard: React Flow owns the node's focusable wrapper, so a
 *                   keydown on a focused node never reaches this card and Enter there only selects it
 *   the chevron   → expands / collapses this subtree
 *   the "+"       → adds a child under this node
 * The buttons all `stopPropagation`, or expanding a department would also open its modal.
 */
import type { CSSProperties } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Plus, UserMinus, Users } from 'lucide-react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { HrAvatar } from './HrAvatar';
import { departmentIcon, departmentTone } from './departmentAppearance';
import type { DeptNodeData, EmpNodeData } from './orgGraph';

export type OrgDeptNode = Node<DeptNodeData, 'orgDepartment'>;
export type OrgEmpNode = Node<EmpNodeData, 'orgEmployee'>;

/**
 * Callbacks the canvas hands to its nodes.
 *
 * Passed through a module-level holder rather than through node `data` on purpose: `data` is rebuilt
 * whenever the graph changes, and putting functions in it would make every node's props unstable and
 * defeat React Flow's memoization on a 200-node canvas.
 */
export interface OrgNodeCallbacks {
  onToggle: (id: string) => void;
  onOpen: (id: string, kind: 'department' | 'employee') => void;
  onAddChild: (id: string, kind: 'department' | 'employee') => void;
  /** Admin-only: the "+" is hidden entirely for everyone else. */
  canEdit: boolean;
}

let callbacks: OrgNodeCallbacks = {
  onToggle: () => {},
  onOpen: () => {},
  onAddChild: () => {},
  canEdit: false,
};

export function setOrgNodeCallbacks(next: OrgNodeCallbacks): void {
  callbacks = next;
}

/**
 * Enter must stay with the button it was pressed on.
 *
 * The keydown bubbles through the card (which used to `preventDefault` it, cancelling the browser's own
 * Enter activation — so Enter on the chevron opened the record INSTEAD of expanding) and on to React
 * Flow's node wrapper, which would additionally select the node.
 */
function keepEnter(ev: React.KeyboardEvent): void {
  if (ev.key === 'Enter') ev.stopPropagation();
}

/**
 * The expand control, as a badge straddling the card's bottom edge.
 *
 * Moved out of the card body deliberately: it sits ON the connector, where the eye already is when it
 * asks "does this branch continue?", and it buys back the whole footer row of height that the taller
 * avatar-on-top layout costs. A collapsed badge reads as the count of what is folded away.
 */
function Chevron({ id, expanded, count }: { id: string; expanded: boolean; count: number }) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      className="hr-onode-chev"
      aria-expanded={expanded}
      aria-label={`${expanded ? 'Collapse' : 'Expand'} ${count} ${count === 1 ? 'person' : 'people'}`}
      onKeyDown={keepEnter}
      onClick={(ev) => {
        ev.stopPropagation();
        callbacks.onToggle(id);
      }}
    >
      <span className="hr-onode-chev-n">{count}</span>
      {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
    </button>
  );
}

function AddButton({ id, kind }: { id: string; kind: 'department' | 'employee' }) {
  if (!callbacks.canEdit) return null;
  return (
    <button
      type="button"
      className="hr-onode-add"
      aria-label={kind === 'department' ? 'Add under this department' : 'Add a direct report'}
      title={kind === 'department' ? 'Add under this department' : 'Add a direct report'}
      onKeyDown={keepEnter}
      onClick={(ev) => {
        ev.stopPropagation();
        callbacks.onAddChild(id, kind);
      }}
    >
      <Plus size={13} />
    </button>
  );
}

/**
 * The keyboard's door into the record.
 *
 * @xyflow/react puts the tabIndex and its own onKeyDown on the `.react-flow__node` wrapper, so the card
 * below is never the focused element: Enter on a focused node only selects it, and the "Enter to open"
 * this label used to promise did not exist. A real button is the only affordance a keyboard user can
 * reach. It borrows the "+" chrome (same square, revealed on hover or focus) rather than inventing a
 * class with no CSS behind it.
 */
function OpenButton({ id, kind }: { id: string; kind: 'department' | 'employee' }) {
  const label = kind === 'department' ? 'Open this department' : 'Open this record';
  return (
    <button
      type="button"
      className="hr-onode-add"
      aria-label={label}
      title={label}
      onKeyDown={keepEnter}
      onClick={(ev) => {
        ev.stopPropagation();
        callbacks.onOpen(id, kind);
      }}
    >
      <ExternalLink size={12} />
    </button>
  );
}

/** Enter opens the record (canvas click is the mouse path). Space still pans. */
function openKeyHandler(id: string, kind: 'department' | 'employee') {
  return (ev: React.KeyboardEvent): void => {
    if (ev.key !== 'Enter') return;
    // Only when the card ITSELF is focused. Everything reaching this handler by bubbling belongs to a
    // button inside the node, and swallowing that keydown cancelled the button's own activation.
    if (ev.target !== ev.currentTarget) return;
    ev.preventDefault();
    callbacks.onOpen(id, kind);
  };
}

export function OrgDepartmentNode({ id, data, selected }: NodeProps<OrgDeptNode>) {
  /**
   * The "No Department" bucket is a label, not a record: there is nothing to open and nothing to add a
   * child to, so it gets neither button. Its own glyph too — a Building icon on the one node that is
   * NOT a building reads as just another department.
   */
  const synthetic = data.synthetic === true;
  const Icon = synthetic ? UserMinus : departmentIcon(data.icon);
  return (
    <div
      className={`hr-onode is-dept${selected ? ' is-selected' : ''}${synthetic ? ' is-unassigned' : ''}`}
      style={{ ['--dc' as string]: departmentTone(data.tone, id) } as CSSProperties}
      onKeyDown={synthetic ? undefined : openKeyHandler(id, 'department')}
      role="group"
      aria-label={
        synthetic
          ? `No Department, ${data.total} unassigned ${data.total === 1 ? 'person' : 'people'}`
          : `${data.label} department, ${data.active} active`
      }
      /* The description is otherwise carried to the canvas and never shown. */
      title={data.description ? `${data.label} — ${data.description}` : data.label}
    >
      <Handle type="target" position={Position.Top} className="hr-ohandle" />

      <span className="hr-onode-face" aria-hidden="true">
        <Icon size={17} />
      </span>

      <div className="hr-onode-card">
        <span className="hr-onode-label">{data.label}</span>
        {/* Headcount and lead share ONE line so a department card is the same two-line box as a person
            card — ranks line up, and the chart reads as one grid instead of two. Ellipsised, because the
            node is a fixed size dagre has already laid out against. */}
        <span className="hr-onode-sub">
          <Users size={10} aria-hidden="true" />
          <strong>{data.active}</strong>
          {data.total !== data.active ? <span className="hr-onode-dim">/{data.total}</span> : null}
          {data.leadName || data.code ? (
            <span className="hr-onode-lead">· {data.leadName || data.code}</span>
          ) : null}
        </span>
        {synthetic ? null : (
          <span className="hr-onode-tools">
            <OpenButton id={id} kind="department" />
            <AddButton id={id} kind="department" />
          </span>
        )}
      </div>

      <Chevron id={id} expanded={data.expanded} count={data.directReports} />
      <Handle type="source" position={Position.Bottom} className="hr-ohandle" />
    </div>
  );
}

export function OrgEmployeeNode({ id, data, selected }: NodeProps<OrgEmpNode>) {
  const terminated = data.status.toLowerCase() === 'terminated';
  return (
    <div
      className={`hr-onode is-emp${selected ? ' is-selected' : ''}${terminated ? ' is-terminated' : ''}`}
      // Inherited from the department this person hangs under, resolved through the SAME seeded helper
      // the department node uses — so a branch is one colour from the org unit down to its last report.
      style={{ ['--dc' as string]: departmentTone(data.tone, data.toneSeed) } as CSSProperties}
      onKeyDown={openKeyHandler(id, 'employee')}
      role="group"
      aria-label={`${data.label}${data.designation ? `, ${data.designation}` : ''}`}
      title={data.label}
    >
      <Handle type="target" position={Position.Top} className="hr-ohandle" />

      <span className="hr-onode-face">
        {/* The node id IS the employee id — that is what the photo-link route is keyed by. */}
        <HrAvatar name={data.label} employeeId={id} photoFileId={data.photoFileId} size="sm" />
      </span>

      <div className="hr-onode-card">
        <span className="hr-onode-label">{data.label}</span>
        <span className="hr-onode-sub">{data.designation ?? '—'}</span>
        <span className="hr-onode-tools">
          <OpenButton id={id} kind="employee" />
          <AddButton id={id} kind="employee" />
        </span>
      </div>

      <Chevron id={id} expanded={data.expanded} count={data.directReports} />
      <Handle type="source" position={Position.Bottom} className="hr-ohandle" />
    </div>
  );
}

export const ORG_NODE_TYPES = {
  orgDepartment: OrgDepartmentNode,
  orgEmployee: OrgEmployeeNode,
};
