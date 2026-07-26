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
      loadingMessage="Connecting SSH tunnel and loading schema…"
      errorHint="The CMP schema is read over an SSH tunnel on :3307. If the tunnel is down the request fails before it reaches MySQL — `pnpm dev:all` starts it, or run `pnpm tunnel` on its own."
      headerIcon={<DatabaseIcon size={14} />}
    />
  );
}
