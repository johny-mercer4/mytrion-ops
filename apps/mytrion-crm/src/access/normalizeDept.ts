/**
 * Normalize a department label to the backend's canonical slug, mirroring the backend's
 * trim → lowercase → hyphenate so knowledge/chat keys match (e.g. "Customer Service" →
 * "customer-service"). Canonical set on the backend includes: sales, billing, finance,
 * verification, maintenance, customer-service, retention, management, c-level.
 */
export function normalizeDept(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
