/** Prev/Next pager shared by the carrier tables — hides itself when everything fits on one page. */
import s from './admin.module.css';

export const PAGE_SIZE = 10;

export function Pager({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (totalPages <= 1) return null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) 0',
      }}
    >
      <span className={s.chipMeta}>
        Page {page} of {totalPages} · {total} total
      </span>
      <button type="button" className={s.ghostBtn} disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Prev
      </button>
      <button type="button" className={s.ghostBtn} disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Next
      </button>
    </div>
  );
}
