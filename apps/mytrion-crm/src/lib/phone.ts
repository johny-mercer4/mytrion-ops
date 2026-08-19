/**
 * Shared US phone display formatter. Handles bare 10-digit and 11-digit-with-leading-'1' inputs
 * regardless of source punctuation, falling back to the raw (trimmed) value when the digit count
 * matches neither shape. Consolidates three near-identical implementations that had drifted into
 * two different formats across modules (Applications, Sales, and everywhere that rendered phone
 * numbers raw with no formatting at all).
 */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw?.trim()) return '';
  const digits = raw.replace(/\D/g, '');
  const ten =
    digits.length === 11 && digits.startsWith('1')
      ? digits.slice(1)
      : digits.length === 10
        ? digits
        : null;
  if (!ten) return raw.trim();
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}
