import type { ZohoContext } from '../zoho/embeddedApp';

/** Renders the resolved Zoho CRM user context (proof the SDK auth + getCurrentUser worked). */
export function UserContextCard({ context }: { context: ZohoContext }): JSX.Element {
  const { user, departmentScope, mocked } = context;
  const rows: Array<[string, string]> = [
    ['Name', user.name || '—'],
    ['Email', user.email || '—'],
    ['Profile', user.profile || '—'],
    ['Role', user.role || '—'],
    ['User ID', user.id || '—'],
    ['Department (derived)', departmentScope ?? '— (none / admin)'],
  ];
  return (
    <section className="card">
      <h2>
        Zoho CRM user {mocked && <span className="badge">DEV MOCK</span>}
      </h2>
      <dl className="kv">
        {rows.map(([k, v]) => (
          <div className="kv-row" key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="hint">
        This identity is sent to the Mytrion Ops backend (profile + role + department) where the
        department-agent RBAC decides the available knowledge and tools.
      </p>
    </section>
  );
}
