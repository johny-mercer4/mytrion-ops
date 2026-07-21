import { getVerificationSchema } from '../../api/verificationSchema';
import { DatabaseIcon } from '../../components/icons';
import { SchemaBrowser } from './SchemaBrowser';

/** Mytrion Admin — Verification DB: a live, read-only schema browser for the credit_platform Postgres. */
export function VerificationDatabase() {
  return (
    <SchemaBrowser
      title="Verification DB"
      subtitle="Live, read-only schema of the credit_platform Postgres — tables, columns, data types, keys and row estimates, for referencing the Sales Mytrion verification pipeline. Structure only; no row data is read. “Last updated” reflects the most recent vacuum/analyze (a proxy for recent writes — Postgres has no per-table write time)."
      load={getVerificationSchema}
      headerIcon={<DatabaseIcon size={14} />}
    />
  );
}
