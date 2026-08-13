import { useEffect, useState, type FormEvent } from 'react';
import { BadgeCheck, Building2, IdCard, Save, ShieldCheck } from 'lucide-react';
import {
  getRecruitSettings,
  updateRecruitSettings,
  type RecruitSettingsDto,
} from '../../api/recruit';
import { RecruitError, RecruitHead, RecruitLoader } from './RecruitBits';

export function RecruitSettings() {
  const [settings, setSettings] = useState<RecruitSettingsDto | null>(null);
  const [location, setLocation] = useState('');
  const [prefix, setPrefix] = useState('EMP');
  const [status, setStatus] = useState('Active');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    getRecruitSettings(controller.signal)
      .then((row) => {
        setSettings(row);
        setLocation(row.defaultLocation ?? '');
        setPrefix(row.employeeIdPrefix);
        setStatus(row.defaultEmployeeStatus);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const row = await updateRecruitSettings({
        defaultLocation: location || null,
        employeeIdPrefix: prefix,
        defaultEmployeeStatus: status,
      });
      setSettings(row);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <RecruitLoader label="Loading Recruit settings" />;

  return (
    <div className="recruit-page">
      <RecruitHead
        eyebrow="Admin controls"
        title="Recruit settings"
        description="Control the defaults used when an accepted candidate becomes a Mytrion HR employee."
      />
      <RecruitError message={error} />

      <section className="recruit-settings-layout">
        <form className="recruit-panel recruit-settings-form" onSubmit={(event) => void save(event)}>
          <div className="recruit-panel-head">
            <div>
              <span className="recruit-section-label">Employee conversion</span>
              <h2>New hire defaults</h2>
            </div>
            <ShieldCheck size={22} />
          </div>
          <p className="recruit-settings-intro">
            These values are applied only when the admin does not provide an override during conversion.
          </p>
          <label className="recruit-setting-row">
            <span className="recruit-setting-icon"><Building2 size={19} /></span>
            <span>
              <strong>Default location</strong>
              <small>Office or region assigned to new employee records.</small>
            </span>
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Tashkent" />
          </label>
          <label className="recruit-setting-row">
            <span className="recruit-setting-icon"><IdCard size={19} /></span>
            <span>
              <strong>Employee ID prefix</strong>
              <small>Used for automatically generated employee IDs.</small>
            </span>
            <input required maxLength={20} value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} />
          </label>
          <label className="recruit-setting-row">
            <span className="recruit-setting-icon"><BadgeCheck size={19} /></span>
            <span>
              <strong>Initial employee status</strong>
              <small>Status assigned at the moment of conversion.</small>
            </span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="Active">Active</option>
              <option value="Onboarding">Onboarding</option>
              <option value="Pending">Pending</option>
            </select>
          </label>
          <footer className="recruit-form-actions">
            {saved ? <span className="recruit-saved"><BadgeCheck size={16} />Saved</span> : null}
            <button type="submit" className="recruit-btn recruit-btn-primary" disabled={saving}>
              <Save size={16} />{saving ? 'Saving…' : 'Save defaults'}
            </button>
          </footer>
        </form>

        <aside className="recruit-panel recruit-settings-guide">
          <span className="recruit-section-label">What happens next</span>
          <h2>Account linking stays deliberate</h2>
          <ol>
            <li><span>1</span><div><strong>Candidate is hired</strong><p>Recruit creates the Mytrion HR employee atomically.</p></div></li>
            <li><span>2</span><div><strong>Zoho user is created</strong><p>Your administrator provisions the sign-in account.</p></div></li>
            <li><span>3</span><div><strong>User is linked</strong><p>The HR employee profile is linked to that Zoho user once available.</p></div></li>
          </ol>
          <div className="recruit-admin-note">
            <ShieldCheck size={18} />
            Recruit settings and employee conversion are available only to administrators.
          </div>
          {settings ? <small>Last updated {new Date(settings.updatedAt).toLocaleString()}</small> : null}
        </aside>
      </section>
    </div>
  );
}
