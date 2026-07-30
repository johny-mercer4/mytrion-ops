/**
 * The two org-canvas node views: a department and a person.
 *
 * Both carry a target handle on top and a source handle on the bottom, which is what makes the chart
 * top-to-bottom AND connectable by hand — dragging from a bottom handle onto another node's top handle
 * re-parents, exactly like dropping the node itself. Same node contract as the Scope blueprint
 * (`admin/scope/Blueprint.tsx`).
 *
 * A node has three affordances, and they must not collide:
 *   the body      → opens the record (single click — handled on the canvas via onNodeClick)
 *   the chevron   → expands / collapses this subtree
 *   the "+"       → adds a child under this node
 * The last two `stopPropagation`, or expanding a department would also open its modal.
 */
import type { CSSProperties } from 'react';
import { ChevronDown, ChevronRight, Plus, Users } from 'lucide-react';
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

function Chevron({ id, expanded, count }: { id: string; expanded: boolean; count: number }) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      className="hr-onode-chev"
      aria-expanded={expanded}
      aria-label={`${expanded ? 'Collapse' : 'Expand'} ${count} ${count === 1 ? 'person' : 'people'}`}
      onClick={(ev) => {
        ev.stopPropagation();
        callbacks.onToggle(id);
      }}
    >
      {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      <span className="hr-onode-chev-n">{count}</span>
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
      onClick={(ev) => {
        ev.stopPropagation();
        callbacks.onAddChild(id, kind);
      }}
    >
      <Plus size={13} />
    </button>
  );
}

/** Enter opens the record (canvas click is the mouse path). Space still pans. */
function openKeyHandler(id: string, kind: 'department' | 'employee') {
  return (ev: React.KeyboardEvent): void => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    callbacks.onOpen(id, kind);
  };
}

export function OrgDepartmentNode({ id, data, selected }: NodeProps<OrgDeptNode>) {
  const Icon = departmentIcon(data.icon);
  return (
    <div
      className={`hr-onode is-dept${selected ? ' is-selected' : ''}`}
      style={{ ['--dc' as string]: departmentTone(data.tone) } as CSSProperties}
      onKeyDown={openKeyHandler(id, 'department')}
      role="group"
      aria-label={`${data.label} department, ${data.active} active. Enter to open.`}
      /* The description is otherwise carried to the canvas and never shown. */
      title={data.description ? `${data.label} — ${data.description}` : data.label}
    >
      <Handle type="target" position={Position.Top} className="hr-ohandle" />

      <div className="hr-onode-row">
        <span className="hr-onode-glyph" aria-hidden="true">
          <Icon size={17} />
        </span>
        <div className="hr-onode-main">
          <span className="hr-onode-label">{data.label}</span>
          <span className="hr-onode-sub">
            {data.code ? <span className="hr-mono">{data.code}</span> : null}
            {data.leadName ? <span>{data.leadName}</span> : null}
          </span>
        </div>
        <AddButton id={id} kind="department" />
      </div>

      <div className="hr-onode-foot">
        <span className="hr-onode-count">
          <Users size={11} />
          <strong>{data.active}</strong>
          {data.total !== data.active ? <span className="hr-onode-dim">/{data.total}</span> : null}
        </span>
        <Chevron id={id} expanded={data.expanded} count={data.directReports} />
      </div>

      <Handle type="source" position={Position.Bottom} className="hr-ohandle" />
    </div>
  );
}

export function OrgEmployeeNode({ id, data, selected }: NodeProps<OrgEmpNode>) {
  const terminated = data.status.toLowerCase() === 'terminated';
  return (
    <div
      className={`hr-onode is-emp${selected ? ' is-selected' : ''}${terminated ? ' is-terminated' : ''}`}
      onKeyDown={openKeyHandler(id, 'employee')}
      role="group"
      aria-label={`${data.label}${data.designation ? `, ${data.designation}` : ''}. Enter to open.`}
      title={data.label}
    >
      <Handle type="target" position={Position.Top} className="hr-ohandle" />

      <div className="hr-onode-row">
        <HrAvatar name={data.label} photoUrl={data.photoUrl} size="sm" />
        <div className="hr-onode-main">
          <span className="hr-onode-label">{data.label}</span>
          <span className="hr-onode-sub">{data.designation ?? '—'}</span>
        </div>
        <AddButton id={id} kind="employee" />
      </div>

      {data.directReports > 0 ? (
        <div className="hr-onode-foot">
          <Chevron id={id} expanded={data.expanded} count={data.directReports} />
        </div>
      ) : null}

      <Handle type="source" position={Position.Bottom} className="hr-ohandle" />
    </div>
  );
}

export const ORG_NODE_TYPES = {
  orgDepartment: OrgDepartmentNode,
  orgEmployee: OrgEmployeeNode,
};
