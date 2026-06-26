import { Badge } from '../../components/Badge';
import { Card } from '../../components/Card';
import { KeyValueList, type KeyValueItem } from '../../components/KeyValueList';
import type { ZohoContext } from '../../zoho/embeddedApp';
import styles from './UserContextCard.module.css';

/** Shows the resolved Zoho CRM user — proof the SDK auth + getCurrentUser ran on mount. */
export function UserContextCard({ context }: { context: ZohoContext }) {
  const { user, departmentScope, mocked } = context;
  const items: KeyValueItem[] = [
    { label: 'Name', value: user.name || '—' },
    { label: 'Email', value: user.email || '—' },
    { label: 'Profile', value: user.profile || '—' },
    { label: 'Role', value: user.role || '—' },
    { label: 'User ID', value: user.id || '—' },
    { label: 'Department (derived)', value: departmentScope ?? '— (none / admin)' },
  ];

  return (
    <Card
      title={
        <>
          Zoho CRM user
          {mocked && <Badge>DEV MOCK</Badge>}
        </>
      }
    >
      <KeyValueList items={items} />
      <p className={styles.hint}>
        This identity is sent to the Mytrion Ops backend (profile + role + department), where the
        department-agent RBAC decides the available knowledge and tools.
      </p>
    </Card>
  );
}
