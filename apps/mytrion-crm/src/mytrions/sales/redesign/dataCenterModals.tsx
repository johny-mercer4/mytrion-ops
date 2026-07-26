/**
 * Data Center drilldowns — Lead and Deal detail modals with inline editing. Read view matches the
 * Sales Mytrion Leads redesign (contact hero, Phone + Cell call rows, MC/DOT/dates); an Edit toggle
 * swaps the owner-editable fields to inputs and saves via the owner-scoped PATCH routes.
 *
 * Editable — Lead: MC / DOT / Referral source / Cell / Phone / Email / Notes. Deal: Email / Phone /
 * Notes. On save we optimistically apply the values locally (instant) AND `invalidateDcCache` so the
 * Data Center list refetches and reflects the change immediately.
 */
import { useState, type ReactNode } from 'react';
import { s } from './dc';
import { Icon } from './icons';
import { badge } from './salesData';
import { useSales } from './ctx';
import { getImpersonation } from '@/api/impersonation';
import { updateDeal, updateLead, type DealEditFields, type LeadEditFields } from '@/api/dataCenter';
import { invalidateDcCache } from './dcCache';
import {
  dealStageColor,
  leadSourceColor,
  leadStatusColor,
  type DealEdit,
  type DealVM,
  type LeadEdit,
  type LeadVM,
} from './dataCenterLive';
import { STATUS_OPTIONS, allowedStatuses, reasonFieldFor } from './leadStatusFlow';
import { LeadStatusPicker } from './LeadStatusPicker';
import { RecordActivityPanels } from './recordActivityPanels';
import { DetailSheet, ModalFooter } from './dataCenterSheet';

function avStyle(col: string): string {
  return `width:52px;height:52px;border-radius:var(--radius-md);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-family:Rajdhani,sans-serif;font-weight:700;font-size:20px;background:color-mix(in srgb,${col} 16%,transparent);color:${col}`;
}
const CARD = 'padding:15px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)';
const CARD_LABEL = 'font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em';
const DATE_ROW = 'display:flex;justify-content:space-between;padding:9px 0;border-top:1px solid var(--border2)';
const CALL_BTN =
  'width:30px;height:30px;border-radius:50%;border:1px solid color-mix(in srgb,var(--accent) 40%,transparent);cursor:pointer;background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent);display:flex;align-items:center;justify-content:center;flex-shrink:0';
const INPUT_CSS =
  'width:100%;height:34px;margin-top:6px;padding:0 11px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:14px;font-family:inherit';
const AREA_CSS =
  'width:100%;margin-top:6px;padding:9px 11px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:14px;line-height:1.55;font-family:inherit;resize:vertical;min-height:84px';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const BODY_GRID =
  'display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:16px;align-items:start';

function StatCard({ label, value, mono, color }: { label: string; value: string; mono?: boolean; color?: string }) {
  return (
    <div style={s(CARD)}>
      <div style={s(CARD_LABEL)}>{label}</div>
      <div style={s(`${mono ? "font-family:'JetBrains Mono',monospace;font-size:21px" : 'font-size:15px'};font-weight:700;margin-top:5px${color ? `;color:${color}` : ''}`)}>
        {value}
      </div>
    </div>
  );
}

function DateRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={s(DATE_ROW)}>
      <span style={s('font-size:13px;color:var(--muted)')}>{label}</span>
      <span style={s("font-size:13px;font-weight:600;color:var(--text2);font-family:'JetBrains Mono',monospace")}>{value}</span>
    </div>
  );
}

function ContactCallRow({ label, value, onCall }: { label: string; value: string; onCall?: (phone: string) => void }) {
  const canCall = Boolean(onCall && value.trim() && value !== '—');
  return (
    <div style={s('display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--border2)')}>
      <div style={s('flex:1;min-width:0')}>
        <div style={s('font-size:11px;color:var(--muted)')}>{label}</div>
        <div style={s("font-size:13px;font-weight:600;color:var(--text2);font-family:'JetBrains Mono',monospace;margin-top:2px")}>
          {value.trim() ? value : '—'}
        </div>
      </div>
      {canCall && (
        <button type="button" aria-label={`Call ${label.toLowerCase()}`} onClick={() => onCall?.(value)} style={s(CALL_BTN)}>
          <Icon name="calls" size={13} />
        </button>
      )}
    </div>
  );
}

/** A labeled read/edit field inside the alt card — value in view mode, input in edit mode. */
function EditCard({
  label,
  editing,
  value,
  display,
  onChange,
  mono,
  span,
  placeholder,
  inputMode,
}: {
  label: string;
  editing: boolean;
  value: string;
  display: ReactNode;
  onChange: (v: string) => void;
  mono?: boolean;
  span?: boolean;
  placeholder?: string;
  inputMode?: 'text' | 'numeric' | 'tel' | 'email';
}) {
  return (
    <div style={s(`${span ? 'grid-column:1 / span 2;' : ''}${CARD}`)}>
      <div style={s(CARD_LABEL)}>{label}</div>
      {editing ? (
        <input
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          placeholder={placeholder}
          inputMode={inputMode ?? 'text'}
          className="ss-in"
          style={s(`${INPUT_CSS}${mono ? ";font-family:'JetBrains Mono',monospace" : ''}`)}
        />
      ) : (
        <div style={s(`${mono ? "font-family:'JetBrains Mono',monospace;font-size:21px;margin-top:5px" : 'font-size:15px;margin-top:5px'};font-weight:700`)}>
          {display}
        </div>
      )}
    </div>
  );
}

/** A labeled read/edit contact row (input in edit mode, call row in view mode). */
function EditContactRow({
  label,
  editing,
  value,
  onChange,
  onCall,
  placeholder,
  inputMode,
}: {
  label: string;
  editing: boolean;
  value: string;
  onChange: (v: string) => void;
  onCall?: (phone: string) => void;
  placeholder?: string;
  inputMode?: 'text' | 'tel' | 'email';
}) {
  if (!editing) return <ContactCallRow label={label} value={value || '—'} {...(onCall ? { onCall } : {})} />;
  return (
    <div style={s('padding:9px 0;border-top:1px solid var(--border2)')}>
      <div style={s('font-size:11px;color:var(--muted)')}>{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder={placeholder}
        inputMode={inputMode ?? 'text'}
        className="ss-in"
        style={s(`${INPUT_CSS};margin-top:4px`)}
      />
    </div>
  );
}

// ---------------- Lead modal ----------------

export function LeadModal({ lead, onClose, onCall }: { lead: LeadVM; onClose: () => void; onCall?: (phone: string) => void }) {
  const { pushToast } = useSales();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applied, setApplied] = useState<LeadEdit>(lead.edit);
  const [form, setForm] = useState<LeadEdit>(lead.edit);
  // Manual status editing — agents also reach clients off-RingCentral, so status is editable here
  // (not only via the post-call wizard). Reason picklist follows Unqualified / Not Interested.
  const [appliedStatus, setAppliedStatus] = useState<string>(lead.status);
  const [statusForm, setStatusForm] = useState<string>(lead.status);
  const [statusReason, setStatusReason] = useState<string>('');
  const statusReasonSpec = reasonFieldFor(statusForm);
  const statusChanged = statusForm !== appliedStatus && STATUS_OPTIONS.some((o) => o.value === statusForm);

  const meta = { col: leadStatusColor(appliedStatus), label: appliedStatus };
  const stageBadge = lead.converted ? badge('Converted', 'var(--ok)') : badge(meta.label, meta.col);
  const callsBadge = badge(`Calls · ${lead.callAttempts}`, 'var(--accent-2)');
  const fleetText = `${lead.trucks} truck${lead.trucks === 1 ? '' : 's'}`;
  const set = (k: keyof LeadEdit, v: string): void => setForm((f) => ({ ...f, [k]: v }));
  const canCallPhone = Boolean(onCall && applied.Phone.trim());

  const startEdit = (): void => {
    setForm(applied);
    setStatusForm(appliedStatus);
    setStatusReason('');
    setEditing(true);
  };
  const cancelEdit = (): void => {
    setForm(applied);
    setStatusForm(appliedStatus);
    setStatusReason('');
    setEditing(false);
  };

  const save = async (): Promise<void> => {
    const changes: LeadEditFields = {};
    (Object.keys(form) as (keyof LeadEdit)[]).forEach((k) => {
      if (form[k] !== applied[k]) changes[k] = form[k];
    });
    if (statusChanged) {
      if (statusReasonSpec && !statusReason) {
        pushToast('Reason required', `Pick a ${statusForm === 'Unqualified' ? 'Unqualified' : 'Not-interested'} reason.`);
        return;
      }
      changes.Status = statusForm;
      if (statusReasonSpec) changes[statusReasonSpec.field] = statusReason;
    }
    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }
    if (typeof changes.Email === 'string' && changes.Email !== '' && !EMAIL_RE.test(changes.Email)) {
      pushToast('Invalid email', 'Enter a valid email address or clear the field.');
      return;
    }
    setSaving(true);
    try {
      await updateLead(lead.id, changes, getImpersonation()?.zohoUserId);
      setApplied({ ...form });
      if (statusChanged) setAppliedStatus(statusForm);
      invalidateDcCache('sales:leads');
      setEditing(false);
      const count = Object.keys(changes).length;
      pushToast('Lead updated', `${count} field${count === 1 ? '' : 's'} saved to Zoho.`);
    } catch (e) {
      pushToast('Update failed', e instanceof Error ? e.message : 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  };

  const referralDisplay = applied.Referral_Source || lead.referral;
  return (
    <DetailSheet
      accent={meta.col}
      ariaLabel={`Lead ${lead.contact}`}
      title={lead.contact}
      subtitle={lead.company}
      avatar={<div style={s(avStyle(meta.col))}>{lead.initials}</div>}
      badges={
        <>
          <span style={s(stageBadge.style)}>{stageBadge.text}</span>
          <span title="Real call attempts — calls placed from Mytrion" style={s(callsBadge.style)}>
            {callsBadge.text}
          </span>
        </>
      }
      onClose={onClose}
      saving={saving}
      footer={
        <ModalFooter
          editing={editing}
          saving={saving}
          onEdit={startEdit}
          onCancel={cancelEdit}
          onSave={save}
          onClose={onClose}
          call={canCallPhone && !editing ? { label: `Call ${applied.Phone}`, phone: applied.Phone } : null}
          {...(onCall ? { onCall } : {})}
        />
      }
    >
      <div style={s(BODY_GRID)}>
          <div style={s('min-width:0')}>
            {editing && (
              <div style={s(`margin-bottom:14px;${CARD};border-color:color-mix(in srgb,var(--accent) 28%,var(--border2))`)}>
                <div style={s(`${CARD_LABEL};margin-bottom:8px;display:inline-flex;align-items:center;gap:6px`)}>
                  <Icon name="edit" size={12} color="var(--accent)" />
                  Lead status
                </div>
                {allowedStatuses(appliedStatus).length > 0 ? (
                  <LeadStatusPicker
                    options={allowedStatuses(appliedStatus)}
                    value={statusForm}
                    onChange={(v) => {
                      setStatusForm(v);
                      setStatusReason('');
                    }}
                  />
                ) : (
                  <div style={s('font-size:13px;color:var(--muted);padding:2px 0')}>
                    No manual status change from “{appliedStatus}” — this stage is set by the process.
                  </div>
                )}
                {statusReasonSpec && (
                  <div style={s('margin-top:10px')}>
                    <div style={s('font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--danger);margin-bottom:6px')}>
                      {statusForm === 'Unqualified' ? 'Unqualified reason' : 'Not-interested reason'} — required
                    </div>
                    <div style={s('display:flex;flex-direction:column;gap:6px')} role="radiogroup" aria-label="Reason">
                      {statusReasonSpec.options.map((r) => {
                        const active = statusReason === r;
                        return (
                          <button
                            key={r}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => setStatusReason(r)}
                            style={s(`text-align:left;padding:8px 12px;border-radius:var(--radius-md);border:1px solid ${active ? 'var(--danger)' : 'var(--border)'};background:${active ? 'color-mix(in srgb,var(--danger) 8%,var(--alt))' : 'var(--alt)'};color:${active ? 'var(--danger)' : 'var(--text)'};font-size:13px;font-weight:700;cursor:pointer`)}
                          >
                            {r}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
              <StatCard label="Fleet Size" value={fleetText} mono />
              <div style={s(CARD)}>
                <div style={s(CARD_LABEL)}>Source</div>
                {(() => {
                  const src = lead.source || 'No source';
                  const c = leadSourceColor(src);
                  return (
                    <div style={s(`margin-top:8px;display:inline-block;font-size:13px;font-weight:700;padding:4px 10px;border-radius:99px;background:color-mix(in srgb,${c} 16%,transparent);color:${c}`)}>
                      {src}
                    </div>
                  );
                })()}
              </div>
              <EditCard label="MC Number" editing={editing} mono value={form.MC} display={applied.MC || '—'} onChange={(v) => set('MC', v)} placeholder="MC #" />
              <EditCard
                label="DOT Number"
                editing={editing}
                mono
                inputMode="numeric"
                value={form.DOT}
                display={applied.DOT || '—'}
                onChange={(v) => set('DOT', v.replace(/\D/g, '').slice(0, 9))}
                placeholder="DOT #"
              />
              <EditCard label="Referral Source" editing={editing} span value={form.Referral_Source} display={referralDisplay} onChange={(v) => set('Referral_Source', v)} placeholder="Referral source" />
            </div>
            <div style={s(`margin-top:14px;${CARD}`)}>
              <div style={s(`${CARD_LABEL};margin-bottom:10px`)}>Contact</div>
              <EditContactRow label="Phone" editing={editing} value={editing ? form.Phone : applied.Phone} onChange={(v) => set('Phone', v)} inputMode="tel" placeholder="Phone" {...(onCall ? { onCall } : {})} />
              <EditContactRow label="Cell" editing={editing} value={editing ? form.Cell : applied.Cell} onChange={(v) => set('Cell', v)} inputMode="tel" placeholder="Cell" {...(onCall ? { onCall } : {})} />
              {editing ? (
                <div style={s('padding:9px 0;border-top:1px solid var(--border2)')}>
                  <div style={s('font-size:11px;color:var(--muted)')}>Email</div>
                  <input value={form.Email} onChange={(e) => set('Email', e.currentTarget.value)} placeholder="name@company.com" inputMode="email" className="ss-in" style={s(`${INPUT_CSS};margin-top:4px`)} />
                </div>
              ) : (
                <div style={s('padding:9px 0;border-top:1px solid var(--border2)')}>
                  <div style={s('font-size:11px;color:var(--muted)')}>Email</div>
                  <div style={s("font-size:13px;font-weight:600;color:var(--text2);font-family:'JetBrains Mono',monospace;margin-top:2px")}>{applied.Email || '—'}</div>
                </div>
              )}
            </div>
            <div style={s(`margin-top:14px;${CARD}`)}>
              <div style={s(`${CARD_LABEL};margin-bottom:10px`)}>Dates</div>
              <DateRow label="Created" value={lead.createdAt} />
              <DateRow label="FB Registration" value={lead.fbRegisteredAt} />
              <DateRow label="Web Registration" value={lead.webRegisteredAt} />
              <DateRow label="Last Activity" value={lead.lastActivityAt} />
              <DateRow label="Modified" value={lead.modifiedAt} />
            </div>
            <div style={s(`margin-top:14px;${CARD}`)}>
              <div style={s(`${CARD_LABEL};margin-bottom:6px;display:inline-flex;align-items:center;gap:6px`)}>
                <Icon name="notes" size={12} />
                Description
              </div>
              {editing ? (
                <textarea value={form.Description} onChange={(e) => set('Description', e.currentTarget.value)} placeholder="Add a note…" className="ss-in" style={s(AREA_CSS)} />
              ) : (
                <div style={s('font-size:14px;line-height:1.6;color:var(--text2);white-space:pre-wrap')}>{applied.Description || 'No description on this lead yet.'}</div>
              )}
            </div>
          </div>
          <div style={s('min-width:0')}>
            <RecordActivityPanels kind="leads" id={lead.id} />
          </div>
      </div>
    </DetailSheet>
  );
}

// ---------------- Deal modal ----------------

export function DealModal({ deal, onClose, onCall }: { deal: DealVM; onClose: () => void; onCall?: (phone: string) => void }) {
  const { pushToast } = useSales();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applied, setApplied] = useState<DealEdit>(deal.edit);
  const [form, setForm] = useState<DealEdit>(deal.edit);

  const meta = { col: dealStageColor(deal.stage), label: deal.stage };
  const stageBadge = badge(meta.label, meta.col);
  const callsBadge = badge(`Calls · ${deal.callAttempts}`, 'var(--accent-2)');
  const set = (k: keyof DealEdit, v: string): void => setForm((f) => ({ ...f, [k]: v }));
  // Prefer the editable Phone; fall back to the display phone (which may carry the Cell) for dialing.
  const callTarget = applied.Phone || (deal.phone !== '—' ? deal.phone : '');
  const canCallPhone = Boolean(onCall && callTarget.trim());

  const startEdit = (): void => {
    setForm(applied);
    setEditing(true);
  };
  const cancelEdit = (): void => {
    setForm(applied);
    setEditing(false);
  };

  const save = async (): Promise<void> => {
    const changes: DealEditFields = {};
    (Object.keys(form) as (keyof DealEdit)[]).forEach((k) => {
      if (form[k] !== applied[k]) changes[k] = form[k];
    });
    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }
    if (typeof changes.Email === 'string' && changes.Email !== '' && !EMAIL_RE.test(changes.Email)) {
      pushToast('Invalid email', 'Enter a valid email address or clear the field.');
      return;
    }
    if (
      typeof changes.Secondary_Email === 'string' &&
      changes.Secondary_Email !== '' &&
      !EMAIL_RE.test(changes.Secondary_Email)
    ) {
      pushToast('Invalid secondary email', 'Enter a valid email address or clear the field.');
      return;
    }
    setSaving(true);
    try {
      await updateDeal(deal.id, changes, getImpersonation()?.zohoUserId);
      setApplied({ ...form });
      invalidateDcCache('sales:deals');
      setEditing(false);
      const count = Object.keys(changes).length;
      pushToast('Deal updated', `${count} field${count === 1 ? '' : 's'} saved to Zoho.`);
    } catch (e) {
      pushToast('Update failed', e instanceof Error ? e.message : 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DetailSheet
      accent={meta.col}
      ariaLabel={`Deal ${deal.company}`}
      title={deal.company}
      subtitle={deal.name}
      avatar={<div style={s(avStyle(meta.col))}>{deal.initials}</div>}
      badges={
        <>
          <span style={s(stageBadge.style)}>{stageBadge.text}</span>
          <span title="Real call attempts — calls placed from Mytrion" style={s(callsBadge.style)}>
            {callsBadge.text}
          </span>
        </>
      }
      onClose={onClose}
      saving={saving}
      footer={
        <ModalFooter
          editing={editing}
          saving={saving}
          onEdit={startEdit}
          onCancel={cancelEdit}
          onSave={save}
          onClose={onClose}
          call={canCallPhone && !editing ? { label: `Call ${callTarget}`, phone: callTarget } : null}
          {...(onCall ? { onCall } : {})}
        />
      }
    >
      <div style={s(BODY_GRID)}>
          <div style={s('min-width:0')}>
            <div style={s(`margin-bottom:14px;${CARD}`)}>
              <div style={s('display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:8px')}>
                <span style={s('text-transform:uppercase;letter-spacing:.05em;font-weight:700;display:inline-flex;align-items:center;gap:6px')}>
                  <Icon name="trend" size={12} />
                  Win probability
                </span>
                <span style={s(`color:${meta.col};font-weight:800;font-family:'JetBrains Mono',monospace`)}>{deal.prob}%</span>
              </div>
              <div style={s('height:8px;border-radius:99px;background:var(--raised);overflow:hidden')}>
                <div style={s(`height:100%;width:${deal.prob}%;background:${meta.col}`)} />
              </div>
              <div style={s('font-size:12px;color:var(--muted);margin-top:9px')}>Expected close {deal.close}</div>
            </div>
            <div style={s('display:grid;grid-template-columns:repeat(3,1fr);gap:12px')}>
              <StatCard label="Cards" value={String(deal.cards)} mono />
              <StatCard label="Application" value={deal.app} />
              <StatCard label="Carrier" value={deal.carrier} />
            </div>
            <div style={s(`margin-top:14px;${CARD}`)}>
              <div style={s(`${CARD_LABEL};margin-bottom:6px`)}>Contact</div>
              <div style={s('font-size:14px;font-weight:600')}>{deal.contact}</div>
              <EditContactRow label="Phone" editing={editing} value={editing ? form.Phone : applied.Phone} onChange={(v) => set('Phone', v)} inputMode="tel" placeholder="Phone" {...(onCall ? { onCall } : {})} />
              <EditContactRow label="Cell" editing={editing} value={editing ? form.Cell : applied.Cell} onChange={(v) => set('Cell', v)} inputMode="tel" placeholder="Cell" {...(onCall ? { onCall } : {})} />
              {editing ? (
                <div style={s('padding:9px 0;border-top:1px solid var(--border2)')}>
                  <div style={s('font-size:11px;color:var(--muted)')}>Email</div>
                  <input value={form.Email} onChange={(e) => set('Email', e.currentTarget.value)} placeholder="name@company.com" inputMode="email" className="ss-in" style={s(`${INPUT_CSS};margin-top:4px`)} />
                </div>
              ) : (
                <div style={s('padding:9px 0;border-top:1px solid var(--border2)')}>
                  <div style={s('font-size:11px;color:var(--muted)')}>Email</div>
                  <div style={s("font-size:13px;font-weight:600;color:var(--text2);font-family:'JetBrains Mono',monospace;margin-top:2px")}>{applied.Email || '—'}</div>
                </div>
              )}
              {editing ? (
                <div style={s('padding:9px 0;border-top:1px solid var(--border2)')}>
                  <div style={s('font-size:11px;color:var(--muted)')}>Secondary email</div>
                  <input value={form.Secondary_Email} onChange={(e) => set('Secondary_Email', e.currentTarget.value)} placeholder="name@company.com" inputMode="email" className="ss-in" style={s(`${INPUT_CSS};margin-top:4px`)} />
                </div>
              ) : (
                <div style={s('padding:9px 0;border-top:1px solid var(--border2)')}>
                  <div style={s('font-size:11px;color:var(--muted)')}>Secondary email</div>
                  <div style={s("font-size:13px;font-weight:600;color:var(--text2);font-family:'JetBrains Mono',monospace;margin-top:2px")}>{applied.Secondary_Email || '—'}</div>
                </div>
              )}
            </div>
            <div style={s(`margin-top:14px;${CARD}`)}>
              <div style={s(`${CARD_LABEL};margin-bottom:6px;display:inline-flex;align-items:center;gap:6px`)}>
                <Icon name="notes" size={12} />
                Description
              </div>
              {editing ? (
                <textarea value={form.Description} onChange={(e) => set('Description', e.currentTarget.value)} placeholder="Add a note…" className="ss-in" style={s(AREA_CSS)} />
              ) : (
                <div style={s('font-size:14px;line-height:1.6;color:var(--text2);white-space:pre-wrap')}>{applied.Description || 'No description on this deal yet.'}</div>
              )}
            </div>
          </div>
          <div style={s('min-width:0')}>
            <RecordActivityPanels kind="deals" id={deal.id} />
          </div>
      </div>
    </DetailSheet>
  );
}
