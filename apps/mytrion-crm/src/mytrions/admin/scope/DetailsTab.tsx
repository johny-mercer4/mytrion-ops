/**
 * Octane Scope — Details sub-tab: platforms & vendors, metrics, and the live
 * risk sections (Blockers / Red Flags / Manual) backed by /v1/scope/risks.
 * Node ids match the RnD Zoho widget, so both UIs edit the SAME records.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createRisk, deleteRisk, listRisks, updateRisk, type RiskCategory, type ScopeRiskItem } from '../../../api/scope';
import { OCT_RISK_DEFAULT_ICON, OCT_RISK_ICONS, hexA, hideLogoTile, ic, platVM, type DetailNode } from './model';
import { scopeToast } from './toast';

const RISK_META: Array<{ key: RiskCategory; label: string; icon: string; color: string }> = [
  { key: 'blocker', label: 'BLOCKERS', icon: 'ban', color: '#F4716F' },
  { key: 'red_flag', label: 'RED FLAGS', icon: 'flag', color: '#FB8A3C' },
  { key: 'manual', label: 'MANUAL PROCESSES', icon: 'hand', color: '#A78BFA' },
];

interface RiskForm {
  category: RiskCategory;
  id: string | null;
  label: string;
  icon: string;
}

export function DetailsTab({ node }: { node: DetailNode }) {
  const platforms = node.platforms.map((p) => platVM(p));
  const metrics = (node.metrics ?? []).map((m) => ({ label: m.label, iconPath: ic(m.icon), value: m.value ?? '?' }));

  return (
    <div className="oct-rail" style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: '28px 36px' }}>
      {platforms.length > 0 && (
        <>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: '.16em', color: 'var(--sub)', marginBottom: 14 }}>
            PLATFORMS &amp; VENDORS
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9, marginBottom: 30 }}>
            {platforms.map((pl, pi) => (
              <span
                key={pi}
                className="oct-plat"
                style={{
                  display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, whiteSpace: 'nowrap', color: 'var(--ink)',
                  border: '1px solid var(--gb)', borderRadius: 5, padding: '9px 15px 9px 8px', background: 'var(--glass)',
                }}
              >
                {pl.logo ? (
                  <span data-logo-tile="1" style={{ display: 'flex', width: 26, height: 26, flex: 'none', alignItems: 'center', justifyContent: 'center', background: '#fff', borderRadius: 4 }}>
                    <img src={pl.logo} alt="" width={16} height={16} onError={hideLogoTile} style={{ display: 'block' }} />
                  </span>
                ) : pl.iconPath ? (
                  <span style={{ display: 'flex', width: 26, height: 26, flex: 'none', alignItems: 'center', justifyContent: 'center', color: node.color }}>
                    <svg width="17" height="17" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d={pl.iconPath} />
                    </svg>
                  </span>
                ) : (
                  <span
                    style={{
                      display: 'flex', width: 20, height: 20, flex: 'none', alignItems: 'center', justifyContent: 'center',
                      background: hexA(node.color, 0.12), borderRadius: 2, fontFamily: "'JetBrains Mono',monospace", fontSize: 8, fontWeight: 600, color: node.color,
                    }}
                  >
                    {pl.abbr}
                  </span>
                )}
                {pl.name}
              </span>
            ))}
          </div>
        </>
      )}

      {metrics.length > 0 && (
        <>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: '.16em', color: 'var(--sub)', marginBottom: 14 }}>METRICS</div>
          <div className="oct-metric-grid">
            {metrics.map((m, mi) => (
              <div
                key={mi}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  border: '1px solid var(--line)', borderRadius: 6, padding: '15px 18px', background: 'var(--glass)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 11, fontSize: 13.5, color: 'var(--sub)' }}>
                  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: node.color, flex: 'none' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d={m.iconPath} />
                  </svg>
                  {m.label}
                </div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 14, color: 'var(--ink)' }}>{m.value}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <RiskSections nodeId={node.id} />
    </div>
  );
}

/** Blockers / Red Flags / Manual — live CRUD against /v1/scope/risks for one node. */
function RiskSections({ nodeId }: { nodeId: string }) {
  const [items, setItems] = useState<ScopeRiskItem[] | null>(null);
  const [form, setForm] = useState<RiskForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setItems(null);
    setForm(null);
    listRisks(nodeId)
      .then((res) => { if (alive) setItems(res.items); })
      .catch((e: unknown) => {
        if (!alive) return;
        setItems([]);
        scopeToast.error('Risk items failed to load', e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [nodeId]);

  const refetch = async () => {
    const res = await listRisks(nodeId);
    if (aliveRef.current) setItems(res.items);
  };

  const save = async () => {
    if (!form || saving) return;
    const label = form.label.trim();
    if (!label) {
      scopeToast.error('Enter a description first.');
      return;
    }
    setSaving(true);
    try {
      if (form.id) await updateRisk(form.id, { label, icon: form.icon });
      else await createRisk({ nodeId, category: form.category, label, icon: form.icon });
      if (!aliveRef.current) return;
      setForm(null);
      await refetch();
      scopeToast.success(form.id ? 'Updated' : 'Added');
    } catch (e) {
      scopeToast.error('Save failed', e instanceof Error ? e.message : String(e));
      await refetch().catch(() => {});
    } finally {
      if (aliveRef.current) setSaving(false);
    }
  };

  const remove = async (item: ScopeRiskItem) => {
    if (saving) return;
    setSaving(true);
    setDeletingId(item.id);
    try {
      await deleteRisk(item.id);
      await refetch();
      if (aliveRef.current) scopeToast.success('Removed');
    } catch (e) {
      scopeToast.error('Delete failed', e instanceof Error ? e.message : String(e));
      await refetch().catch(() => {});
    } finally {
      if (aliveRef.current) {
        setSaving(false);
        setDeletingId(null);
      }
    }
  };

  if (items === null) {
    return (
      <div className="oct-risk">
        <div className="oct-risk-loading">
          <span className="oct-risk-spin" /> Loading risk items…
        </div>
      </div>
    );
  }

  return (
    <div className="oct-risk">
      {RISK_META.map((sec) => {
        const list = items.filter((i) => i.category === sec.key);
        const formOpen = form?.category === sec.key;
        return (
          <div key={sec.key} className="oct-risk-sec" style={{ '--rc': sec.color } as CSSProperties}>
            <div className="oct-risk-sec__label">
              <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" d={ic(sec.icon)} />
              </svg>
              <span style={{ flex: 1 }}>{sec.label}</span>
              <button
                type="button"
                className="oct-risk-add"
                title="Add item"
                onClick={() => setForm({ category: sec.key, id: null, label: '', icon: OCT_RISK_DEFAULT_ICON[sec.key] ?? 'flag' })}
              >
                <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </div>
            <div className="oct-risk-list">
              {list.map((item) => (
                <div key={item.id} className="oct-risk-row">
                  <span className="oct-risk-row__icon">
                    <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" d={ic(item.icon) || ic(sec.icon)} />
                    </svg>
                  </span>
                  <span className="oct-risk-row__text">{item.label}</span>
                  {deletingId === item.id ? (
                    <span className="oct-risk-spin oct-risk-spin--row" />
                  ) : (
                    <span className="oct-risk-row__act">
                      <button
                        type="button"
                        title="Edit"
                        onClick={() => setForm({ category: sec.key, id: item.id, label: item.label, icon: item.icon || (OCT_RISK_DEFAULT_ICON[sec.key] ?? 'flag') })}
                      >
                        <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button type="button" title="Remove" onClick={() => void remove(item)}>
                        <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </span>
                  )}
                </div>
              ))}

              {formOpen && form && (
                <div className="oct-risk-form">
                  <input
                    className="oct-risk-form__input"
                    value={form.label}
                    placeholder="Describe the item…"
                    autoFocus
                    onChange={(e) => setForm({ ...form, label: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void save();
                      }
                    }}
                  />
                  <div className="oct-risk-form__icons">
                    {OCT_RISK_ICONS.map((ik) => (
                      <button
                        key={ik}
                        type="button"
                        className={`oct-risk-icon ${form.icon === ik ? 'active' : ''}`}
                        onClick={() => setForm({ ...form, icon: ik })}
                      >
                        <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d={ic(ik)} />
                        </svg>
                      </button>
                    ))}
                  </div>
                  <div className="oct-risk-form__act">
                    <button type="button" className="oct-btn oct-btn-ghost" onClick={() => setForm(null)}>
                      Cancel
                    </button>
                    <button type="button" className="oct-btn oct-btn-primary" disabled={saving} onClick={() => void save()}>
                      {saving && <span className="oct-risk-spin" />}
                      {saving ? 'Saving…' : form.id ? 'Save' : 'Add'}
                    </button>
                  </div>
                </div>
              )}

              {!list.length && !formOpen && <div className="oct-risk-empty">No items yet — add one.</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
