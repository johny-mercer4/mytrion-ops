import { getCmpSchema } from '../../api/cmpSchema';
import { DatabaseIcon } from '../../components/icons';
import { SchemaBrowser } from './SchemaBrowser';

/** Mytrion Admin — CMP Database: a live, read-only schema browser for the CMP MySQL. */
export function CmpDatabase() {
  return (
    <SchemaBrowser
      title="CMP Database"
      subtitle="Live, read-only schema of the CMP MySQL — tables, columns, data types, and how recently each table was written. Structure only; no row data is ever read."
      load={getCmpSchema}
      headerIcon={<DatabaseIcon size={14} />}
    />
  );
}
