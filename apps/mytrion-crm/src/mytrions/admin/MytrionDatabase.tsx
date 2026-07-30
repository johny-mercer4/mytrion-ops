import { getMytrionSchema } from '../../api/mytrionSchema';
import { DatabaseIcon } from '../../components/icons';
import { SchemaBrowser } from './SchemaBrowser';

/** Mytrion Admin — searchable, live metadata for Mytrion's authoritative PostgreSQL database. */
export function MytrionDatabase() {
  return (
    <SchemaBrowser
      title="Mytrion Database"
      subtitle="Live, read-only metadata for Mytrion PostgreSQL: every non-system schema, table, view, column/API name, SQL type, key, row estimate and write-frequency estimate. Frequency is derived from PostgreSQL statistics since their last reset; no row contents are read."
      load={getMytrionSchema}
      errorHint="Check MYTRION_OPS_DATABASE_URL and database connectivity. This inspector uses the same application database connection as Mytrion."
      headerIcon={<DatabaseIcon size={14} />}
    />
  );
}
