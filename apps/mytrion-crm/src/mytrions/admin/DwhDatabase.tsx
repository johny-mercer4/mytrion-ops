import { getDwhSchema } from '../../api/dwhSchema';
import { WarehouseIcon } from '../../components/icons';
import { SchemaBrowser } from './SchemaBrowser';

/** Mytrion Admin — Data Warehouse: a live, read-only schema browser for the DWH Postgres (all schemas). */
export function DwhDatabase() {
  return (
    <SchemaBrowser
      title="Data Warehouse"
      subtitle="Live, read-only schema of the DWH Postgres across all schemas — tables, columns, data types, keys and row estimates. Structure only; no row data is read. “Last updated” reflects the most recent vacuum/analyze (Postgres has no per-table write time)."
      load={getDwhSchema}
      headerIcon={<WarehouseIcon size={14} />}
    />
  );
}
