import { useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, RefreshCw, Search } from 'lucide-react';
// Shared stale-while-revalidate cache (the app's Data-Center caching system) — instant re-entry.
import { useCachedLoad, formatCachedAt } from '../../sales/redesign/dcCache';
import {
  listChildReferrals,
  listParentReferrers,
  listReferralAssociations,
  type CrmRow,
  type ReferralAssociations,
  type ReferralField,
} from '../../../api/referrals';

interface ParentGroup {
  parent: CrmRow;
  children: CrmRow[];
}
type LinkField = 'Parent_Referrer' | 'Child_Referrer';

/** Format one raw Zoho value: lookups → name, booleans → Yes/No, urls → link, empty → N/A badge. */
function renderCell(value: unknown): { text: string; href?: string; empty?: boolean } {
  if (value === null || value === undefined || value === '') return { text: 'N/A', empty: true };
  if (typeof value === 'boolean') return { text: value ? 'Yes' : 'No' };
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (o.name != null) return { text: String(o.name) };
    if (o.id != null) return { text: String(o.id) };
    return { text: JSON.stringify(value) };
  }
  const s = String(value);
  if (/^https?:\/\//i.test(s)) return { text: s.length > 48 ? `${s.slice(0, 48)}…` : s, href: s };
  return { text: s };
}

/** A single value, N/A-badged when empty. */
function Value({ value }: { value: unknown }) {
  const cell = renderCell(value);
  if (cell.empty) return <span className="mg-na">N/A</span>;
  if (cell.href)
    return (
      <a href={cell.href} target="_blank" rel="noreferrer">
        {cell.text}
      </a>
    );
  return <>{cell.text}</>;
}

function rowMatches(row: CrmRow, q: string): boolean {
  if (!q) return true;
  return Object.values(row).some((v) => renderCell(v).text.toLowerCase().includes(q));
}

const str = (v: unknown): string => (v == null ? '' : String(v).trim());
const parentRefId = (p: CrmRow): string => str(p.ReferrerId);
const childRefId = (c: CrmRow): string => str(c.Referrer_ID);
/** Read the record id out of a lookup field ({name,id}) — the grouping key. */
const lookupId = (rec: CrmRow, field: string): string => {
  const v = rec[field];
  return v && typeof v === 'object' && 'id' in v ? str((v as { id?: unknown }).id) : '';
};

/** Full-field definition grid (label → value) — shows every field without a wide table. */
function DetailGrid({ fields, row }: { fields: ReferralField[]; row: CrmRow }) {
  return (
    <dl className="mg-dl">
      {fields.map((f) => (
        <div className="mg-dl-item" key={f.apiName}>
          <dt title={`${f.apiName} · ${f.type}`}>{f.label}</dt>
          <dd>
            <Value value={row[f.apiName]} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Referrer-code chip, or an N/A badge when blank. */
function RefChip({ code, alt }: { code: string; alt?: boolean }) {
  if (!code) return <span className="mg-na">N/A</span>;
  return <span className={`mg-refchip${alt ? ' mg-refchip-alt' : ''}`}>{code}</span>;
}

/** Leads or Deals that reference a parent/child — a labelled, compact list. */
function LinkedSection({
  label,
  kind,
  fields,
  rows,
}: {
  label: string;
  kind: string;
  fields: ReferralField[];
  rows: CrmRow[];
}) {
  const nameKey = fields[0]?.apiName;
  return (
    <>
      <div className="mg-section-label">
        {label} · {rows.length}
      </div>
      {rows.length === 0 ? (
        <div className="mg-empty-sm">None.</div>
      ) : (
        rows.map((r) => (
          <div className="mg-link" key={str(r.id)}>
            <div className="mg-child-head">
              <span className="mg-kindchip">{kind}</span>
              <span className="mg-child-name">{(nameKey && str(r[nameKey])) || 'Unnamed'}</span>
            </div>
            <DetailGrid fields={fields} row={r} />
          </div>
        ))
      )}
    </>
  );
}

function ChildBlock({
  child,
  fields,
  assoc,
}: {
  child: CrmRow;
  fields: ReferralField[];
  assoc: ReferralAssociations | null;
}) {
  const id = str(child.id);
  const leads = assoc ? assoc.leads.rows.filter((l) => lookupId(l, 'Child_Referrer') === id) : [];
  const deals = assoc ? assoc.deals.rows.filter((d) => lookupId(d, 'Child_Referrer') === id) : [];
  return (
    <div className="mg-child">
      <div className="mg-child-head">
        <RefChip code={childRefId(child)} alt />
        <span className="mg-child-name">{str(child.Name) || 'Unnamed'}</span>
        {str(child.Referral_Type) ? <span className="mg-tagchip">{str(child.Referral_Type)}</span> : null}
      </div>
      <DetailGrid fields={fields} row={child} />
      {assoc ? (
        <>
          <LinkedSection label="Leads (Child Referral)" kind="Lead" fields={assoc.leads.fields} rows={leads} />
          <LinkedSection label="Deals (Child Referral)" kind="Deal" fields={assoc.deals.fields} rows={deals} />
        </>
      ) : null}
    </div>
  );
}

/**
 * Referrals card — parent referrers with their child referrals nested in an accordion, plus the Leads
 * and Deals that reference each parent/child (via Parent_Referrer / Child_Referrer). Children link to
 * a parent by referrer id (child.Referrer_ID === parent.ReferrerId), falling back to the Parent_Referrer
 * lookup. Every field is shown; empty values read as N/A. Data is served stale-while-revalidate
 * (useCachedLoad) so re-entering the card paints instantly. Fetched from prod Zoho CRM.
 */
export function ReferralsCard({ onBack }: { onBack?: () => void }) {
  const { data, loading, revalidating, error, reload, cachedAt } = useCachedLoad(
    'manager:referrals',
    async () => {
      const [parents, children, assoc] = await Promise.all([
        listParentReferrers(),
        listChildReferrals(),
        listReferralAssociations(),
      ]);
      return { parents, children, assoc };
    },
    { staleMs: 120_000 },
  );
  const [q, setQ] = useState('');

  const parents = data?.parents ?? null;
  const children = data?.children ?? null;
  const assoc = data?.assoc ?? null;

  const { groups, orphans, linkedCount } = useMemo(() => {
    const empty: { groups: ParentGroup[]; orphans: CrmRow[]; linkedCount: number } = {
      groups: [],
      orphans: [],
      linkedCount: 0,
    };
    if (!parents || !children) return empty;
    const built: ParentGroup[] = parents.rows.map((parent) => {
      const pid = parentRefId(parent);
      const pRecId = str(parent.id);
      const kids = children.rows.filter(
        (c) =>
          (pid !== '' && childRefId(c) === pid) ||
          (lookupId(c, 'Parent_Referrer') !== '' && lookupId(c, 'Parent_Referrer') === pRecId),
      );
      return { parent, children: kids };
    });
    const matched = new Set(built.flatMap((g) => g.children.map((c) => str(c.id))));
    const orphaned = children.rows.filter((c) => !matched.has(str(c.id)));
    return { groups: built, orphans: orphaned, linkedCount: matched.size };
  }, [parents, children]);

  const linked = (id: string, field: LinkField, kind: 'leads' | 'deals'): CrmRow[] =>
    assoc ? assoc[kind].rows.filter((r) => lookupId(r, field) === id) : [];

  const ql = q.trim().toLowerCase();
  const shownGroups = groups.filter(
    (g) => rowMatches(g.parent, ql) || g.children.some((c) => rowMatches(c, ql)),
  );
  const shownOrphans = orphans.filter((c) => rowMatches(c, ql));
  const busy = loading || revalidating;

  return (
    <div className="mg-page">
      <header className="mg-page-head">
        <div className="mg-page-head-left">
          {onBack ? (
            <button type="button" className="mg-backbtn" onClick={onBack} aria-label="Back to overview">
              <ArrowLeft size={16} />
            </button>
          ) : null}
          <div>
            <h1 className="mg-page-title">Referrals</h1>
            <p className="mg-page-sub">
              Parent referrers, their child referrals (by referrer id), and the Leads &amp; Deals that
              reference each — full details, from prod Zoho CRM.
            </p>
          </div>
        </div>
        <div className="mg-head-actions">
          {cachedAt ? <span className="mg-cachedat">Updated {formatCachedAt(cachedAt)}</span> : null}
          <button type="button" className="mg-btn" onClick={reload} disabled={busy}>
            <RefreshCw size={15} className={busy ? 'mg-spin' : ''} />
            Refresh
          </button>
        </div>
      </header>

      <div className="mg-toolbar">
        {parents && children ? (
          <div className="mg-summary">
            <strong>{parents.total}</strong> parent referrers · <strong>{children.total}</strong> child
            referrals · <strong>{linkedCount}</strong> linked · <strong>{orphans.length}</strong> unlinked
          </div>
        ) : (
          <span />
        )}
        <label className="mg-search">
          <Search size={15} />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter parents & children…"
            aria-label="Filter referral records"
          />
        </label>
      </div>

      {loading ? (
        <div className="mg-loading">
          <span className="mg-spinner" aria-hidden="true" />
          Loading referral records…
        </div>
      ) : error && !parents ? (
        <div className="mg-error">
          <p>{error}</p>
          <button type="button" className="mg-btn" onClick={reload}>
            Retry
          </button>
        </div>
      ) : parents && children ? (
        <div className="mg-acc-list">
          {shownGroups.length === 0 && shownOrphans.length === 0 ? (
            <div className="mg-empty">No referral records match “{q.trim()}”.</div>
          ) : null}

          {shownGroups.map((g) => {
            const pid = str(g.parent.id);
            return (
              <details className="mg-acc" key={pid} {...(ql ? { open: true } : {})}>
                <summary className="mg-acc-summary">
                  <ChevronRight size={16} className="mg-acc-chevron" />
                  <RefChip code={parentRefId(g.parent)} />
                  <span className="mg-acc-name">{str(g.parent.Name) || 'Unnamed referrer'}</span>
                  <span className="mg-acc-company">{str(g.parent.Company_Name)}</span>
                  <span className={`mg-count${g.children.length ? '' : ' mg-count-zero'}`}>
                    {g.children.length} {g.children.length === 1 ? 'child' : 'children'}
                  </span>
                </summary>
                <div className="mg-acc-body">
                  <div className="mg-section-label">Parent details</div>
                  <DetailGrid fields={parents.fields} row={g.parent} />
                  {assoc ? (
                    <>
                      <LinkedSection
                        label="Leads (Parent Referrer)"
                        kind="Lead"
                        fields={assoc.leads.fields}
                        rows={linked(pid, 'Parent_Referrer', 'leads')}
                      />
                      <LinkedSection
                        label="Deals (Parent Referrer)"
                        kind="Deal"
                        fields={assoc.deals.fields}
                        rows={linked(pid, 'Parent_Referrer', 'deals')}
                      />
                    </>
                  ) : null}
                  <div className="mg-section-label">Child referrals · {g.children.length}</div>
                  {g.children.length === 0 ? (
                    <div className="mg-empty-sm">No child referrals linked to this referrer id.</div>
                  ) : (
                    g.children.map((child) => (
                      <ChildBlock key={str(child.id)} child={child} fields={children.fields} assoc={assoc} />
                    ))
                  )}
                </div>
              </details>
            );
          })}

          {shownOrphans.length > 0 ? (
            <details className="mg-acc mg-acc-orphan" {...(ql ? { open: true } : {})}>
              <summary className="mg-acc-summary">
                <ChevronRight size={16} className="mg-acc-chevron" />
                <span className="mg-acc-name">Unlinked child referrals</span>
                <span className="mg-count mg-count-zero">{shownOrphans.length}</span>
              </summary>
              <div className="mg-acc-body">
                <div className="mg-empty-sm">
                  These child referrals have no parent match (their referrer id doesn’t match any parent).
                </div>
                {shownOrphans.map((child) => (
                  <ChildBlock key={str(child.id)} child={child} fields={children.fields} assoc={assoc} />
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
