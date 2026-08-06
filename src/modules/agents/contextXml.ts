/**
 * One XML boundary for every dynamic agent-context projection. XML is prompt formatting only;
 * authorization remains in the server-side TenantContext carried by AsyncLocalStorage.
 */

// XML 1.0 permits tab, LF and CR but not the remaining C0 controls or lone surrogates.
// eslint-disable-next-line no-control-regex -- removing invalid XML characters is intentional.
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]|[\uD800-\uDFFF]/g;

export function cleanXmlValue(value: unknown, maxChars = 4_000): string {
  let text: string;
  if (typeof value === 'string') text = value;
  else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  const clean = text.replace(INVALID_XML, '').trim();
  return clean.length <= maxChars ? clean : `${clean.slice(0, maxChars)}…`;
}

export function xmlText(value: unknown, maxChars = 4_000): string {
  return escapeBounded(cleanXmlValue(value, maxChars), maxChars, false);
}

export function xmlAttr(value: unknown, maxChars = 500): string {
  return escapeBounded(cleanXmlValue(value, maxChars), maxChars, true);
}

function escapeBounded(value: string, maxChars: number, attribute: boolean): string {
  let escaped = '';
  for (const char of value) {
    const next = char === '&'
      ? '&amp;'
      : char === '<'
        ? '&lt;'
        : char === '>'
          ? '&gt;'
          : attribute && char === '"'
            ? '&quot;'
            : attribute && char === "'"
              ? '&apos;'
              : char;
    if (escaped.length + next.length > Math.max(0, maxChars - 1)) return `${escaped}…`;
    escaped += next;
  }
  return escaped;
}

export function xmlElement(
  name: string,
  value: unknown,
  opts: { indent?: number; maxChars?: number; attrs?: Record<string, unknown> } = {},
): string {
  const indent = ' '.repeat(opts.indent ?? 0);
  const attrs = Object.entries(opts.attrs ?? {})
    .map(([key, val]) => ` ${key}="${xmlAttr(val)}"`)
    .join('');
  return `${indent}<${name}${attrs}>${xmlText(value, opts.maxChars)}</${name}>`;
}
