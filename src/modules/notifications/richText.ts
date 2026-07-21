/**
 * Rich-text sanitizer for client_news bodies — the AUTHORITATIVE gate (the CRM editor and the
 * mini-app renderer both also behave, but neither is trusted). Whitelist-only: any tag outside
 * the set is dropped entirely, every attribute is dropped except a[href] restricted to
 * http(s)/mailto, and links always reopen in a new tab. No dependencies on purpose — a regex
 * tag-filter over a comment-stripped string is enough for a WHITELIST this small, because
 * nothing that survives can carry an event handler, style, or javascript: URL.
 */
const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'p', 'br', 'ul', 'ol', 'li', 'h3', 'a', 'img']);

export function sanitizeRichText(html: string): string {
  const noComments = html.replace(/<!--[\s\S]*?-->/g, '');
  return noComments.replace(/<\/?\s*([a-zA-Z0-9]+)((?:\s[^<>]*?)?)\s*\/?>/g, (match, tag: string, attrs: string) => {
    const t = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(t)) return '';
    if (match.startsWith('</')) return `</${t}>`;
    if (t === 'a') {
      const href = /href\s*=\s*"((?:https?:\/\/|mailto:)[^"]*)"/i.exec(attrs)?.[1];
      return href ? `<a href="${href.replace(/"/g, '')}" target="_blank" rel="noopener noreferrer">` : '<a>';
    }
    if (t === 'img') {
      // https-only src, optional alt — nothing else survives (no width/style/onerror).
      const src = /src\s*=\s*"(https:\/\/[^"]*)"/i.exec(attrs)?.[1];
      if (!src) return '';
      const alt = /alt\s*=\s*"([^"<>]*)"/i.exec(attrs)?.[1] ?? '';
      return `<img src="${src.replace(/"/g, '')}" alt="${alt.replace(/"/g, '')}">`;
    }
    if (t === 'br') return '<br>';
    return `<${t}>`;
  });
}

/** Titles are PLAIN text — strip every tag and collapse whitespace. */
export function sanitizePlainText(text: string): string {
  return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
