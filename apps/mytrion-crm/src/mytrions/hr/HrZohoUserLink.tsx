import { useEffect, useMemo, useState } from 'react';
import { Link2, ShieldCheck, Unlink } from 'lucide-react';
import {
  linkHrEmployeeZohoUser,
  listHrZohoUsers,
  type HrEmployeeDto,
  type HrZohoUserDto,
} from '../../api/hr';
import { invalidateHrEmployees } from './hrData';

export function HrZohoUserLink({ employee }: { employee: HrEmployeeDto }) {
  const [users, setUsers] = useState<HrZohoUserDto[]>([]);
  const [selected, setSelected] = useState(employee.zohoUserId ?? '');
  const [linkedId, setLinkedId] = useState(employee.zohoUserId ?? '');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    listHrZohoUsers(controller.signal)
      .then(setUsers)
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

  const linkedUser = useMemo(
    () => users.find((user) => user.id === linkedId),
    [linkedId, users],
  );

  const save = async (zohoUserId: string | null): Promise<void> => {
    setSaving(true);
    setError('');
    try {
      const row = await linkHrEmployeeZohoUser(employee.id, zohoUserId);
      setLinkedId(row.zohoUserId ?? '');
      setSelected(row.zohoUserId ?? '');
      invalidateHrEmployees();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="hr-zoho-link">
      <div className="hr-zoho-link-head">
        <span><Link2 size={17} /></span>
        <div>
          <strong>Zoho sign-in</strong>
          <small>Link the CRM user created for this employee.</small>
        </div>
        {linkedId ? <em><ShieldCheck size={14} />Linked</em> : null}
      </div>
      {linkedId ? (
        <div className="hr-zoho-current">
          <div>
            <strong>{linkedUser?.name || linkedUser?.email || linkedId}</strong>
            <small>{linkedUser?.email || `Zoho user ${linkedId}`}</small>
          </div>
          <button type="button" className="hr-btn" disabled={saving} onClick={() => void save(null)}>
            <Unlink size={14} /> Unlink
          </button>
        </div>
      ) : (
        <div className="hr-zoho-picker">
          <select
            value={selected}
            disabled={loading || saving}
            onChange={(event) => setSelected(event.target.value)}
            aria-label="Zoho user"
          >
            <option value="">{loading ? 'Loading Zoho users…' : 'Choose a Zoho user…'}</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name || user.email || user.id}{user.email && user.name ? ` · ${user.email}` : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="hr-btn hr-btn-primary"
            disabled={!selected || saving}
            onClick={() => void save(selected)}
          >
            <Link2 size={14} />{saving ? 'Linking…' : 'Link user'}
          </button>
        </div>
      )}
      {error ? <p className="hr-banner-error">{error}</p> : null}
    </section>
  );
}
