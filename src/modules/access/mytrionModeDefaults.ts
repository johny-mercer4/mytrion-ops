/**
 * The mode a Mytrion falls back to when no access layer (per-user / role / permission-set) decided one.
 *
 * Most Mytrions default to FULL — a bare grant implies write. HR is the exception (and today the only
 * one): a plain HR grant is the people DIRECTORY, look-only. Creating employees or departments and
 * moving the org chart is an explicit "HR Manager" capability (`hr: full`, set in Admin → User
 * Management), so HR defaults to READ — a new hire is read-only until promoted, rather than a manager
 * until someone remembers to downgrade them.
 */
import type { MytrionAccessMode, MytrionId } from '../../lib/mytrions.js';

const READ_DEFAULT_MYTRIONS: ReadonlySet<MytrionId> = new Set<MytrionId>(['hr']);

export function defaultMode(id: MytrionId): MytrionAccessMode {
  return READ_DEFAULT_MYTRIONS.has(id) ? 'read' : 'full';
}
