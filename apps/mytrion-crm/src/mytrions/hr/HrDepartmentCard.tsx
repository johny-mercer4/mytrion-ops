/**
 * One department, as a card.
 *
 * Replaces the seven-column table this tab used to be. A department is an entity with an identity — a
 * glyph, a colour, a lead, a purpose — and a table row made every one of those the same shade of grey
 * while giving equal width to `mail_alias` and `source`, two columns nobody reads. Those two are gone
 * from the UI (the columns still exist; `source` is how the Zoho migration tracks what it still owns).
 *
 * The whole card is the click target that opens the editable modal, so it is a real `<button>`:
 * keyboard users get Enter/Space and the focus ring for free.
 *
 * `--dc` carries the department's tone into the card so the glyph, the border-hover and the code chip
 * all pick it up from one declaration. It is resolved through `departmentTone`, never interpolated from
 * the stored value.
 */
import type { CSSProperties } from 'react';
import { Users } from 'lucide-react';
import type { HrDepartmentDto } from '../../api/hr';
import { departmentIcon, departmentTone } from './departmentAppearance';

/** Markdown stripped back to a single line of prose, for the card's two-line summary. */
function summarize(markdown: string | null): string {
  if (!markdown) return '';
  return markdown
    .replace(/```[\s\S]*?```/g, ' ') // fenced code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → their text
    .replace(/[*_`>#]/g, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function HrDepartmentCard({
  department,
  headcount,
  onOpen,
  busy,
}: {
  department: HrDepartmentDto;
  /** Live headcount from the directory — the table never showed this and it is the first thing asked. */
  headcount: { total: number; active: number } | undefined;
  onOpen: (d: HrDepartmentDto) => void;
  busy?: boolean;
}) {
  const Icon = departmentIcon(department.icon);
  const tone = departmentTone(department.iconColor, department.id);
  const blurb = summarize(department.description);

  return (
    <button
      type="button"
      className={`hr-deptc${busy ? ' hr-card-saving' : ''}`}
      style={{ ['--dc' as string]: tone } as CSSProperties}
      onClick={() => onOpen(department)}
      aria-label={`Open ${department.name}`}
      aria-busy={busy}
    >
      <span className="hr-empc-shimmer" aria-hidden="true" />

      <span className="hr-deptc-top">
        <span className="hr-deptc-glyph" aria-hidden="true">
          <Icon size={20} />
        </span>
        <span className="hr-deptc-ident">
          <span className="hr-deptc-name">{department.name}</span>
          {department.code ? <span className="hr-deptc-code">{department.code}</span> : null}
        </span>
      </span>

      {blurb ? (
        <span className="hr-deptc-desc">{blurb}</span>
      ) : (
        <span className="hr-deptc-desc is-empty">No description yet.</span>
      )}

      <span className="hr-deptc-meta">
        <span className="hr-deptc-head">
          <Users size={12} />
          {/* THREE states, not two. `undefined` means the directory has not landed (it is a second,
              slower fetch than the departments themselves, and it re-fetches after every member
              change) — claiming "No one assigned" there states something false about a department
              that may be fully staffed. Only a zero-filled headcount is real emptiness. */}
          {headcount === undefined ? (
            <span title="Headcount still loading">—</span>
          ) : headcount.total === 0 ? (
            <>No one assigned</>
          ) : (
            <>
              <strong>{headcount.active}</strong> active
              {headcount.total !== headcount.active ? <> · {headcount.total} total</> : null}
            </>
          )}
        </span>
        <span className="hr-deptc-lead">
          {department.leadName ? `Lead · ${department.leadName}` : 'Lead · —'}
        </span>
        {department.parentName ? (
          <span className="hr-deptc-parent">Under {department.parentName}</span>
        ) : null}
      </span>
    </button>
  );
}
