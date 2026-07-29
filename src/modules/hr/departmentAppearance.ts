/**
 * Validation for the two "how does this department LOOK" columns (`hr_departments.icon`,
 * `icon_color`).
 *
 * The design goal is that a stored value can never become markup or a style rule. That is enforced in
 * two places, and neither trusts the other:
 *
 *  - HERE, by SHAPE: an icon is a bare PascalCase identifier and a colour is a `tone-*` token name.
 *    Nothing with a quote, angle bracket, brace, semicolon, parenthesis, or `url(` can be stored, so
 *    even a future consumer that interpolated the value straight into CSS or HTML has nothing to work
 *    with.
 *  - IN THE UI, by SET: the picker looks the name up in a static map of imported lucide components
 *    and a static map of tone tokens, falling back to the module default when it misses.
 *
 * Deliberately NOT a hard-coded list of the ~1,600 lucide names. A list would have to be duplicated in
 * the client (which needs the component references, not the strings) and the two copies would drift —
 * whereas shape-here + set-there has no shared list to drift and no way for an unknown name to render
 * as anything but the fallback icon.
 */

/** A lucide-react component name: PascalCase, letters and digits only (e.g. `Building2`, `Truck`). */
const ICON_NAME = /^[A-Z][A-Za-z0-9]{0,39}$/;

/** A Horizon tone token name WITHOUT the leading dashes (e.g. `tone-sky`, `tone-emerald`). */
const TONE_NAME = /^tone-[a-z]{2,20}$/;

export function isValidDepartmentIcon(value: string): boolean {
  return ICON_NAME.test(value);
}

export function isValidDepartmentTone(value: string): boolean {
  return TONE_NAME.test(value);
}

/**
 * Normalize a submitted icon name: trimmed, or null when empty/invalid.
 *
 * An invalid name becomes null rather than an error. The field is decoration — refusing to save a
 * department's name and description because a picker sent an unrecognised glyph would be a worse
 * outcome than that department showing the default icon.
 */
export function normalizeDepartmentIcon(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  return isValidDepartmentIcon(v) ? v : null;
}

/** Same contract as `normalizeDepartmentIcon`, for the tone token. */
export function normalizeDepartmentTone(value: string | null | undefined): string | null {
  const v = (value ?? '').trim().replace(/^-+/, '');
  if (!v) return null;
  return isValidDepartmentTone(v) ? v : null;
}
