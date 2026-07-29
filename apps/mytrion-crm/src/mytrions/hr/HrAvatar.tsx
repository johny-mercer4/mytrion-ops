import { useState } from 'react';

/**
 * Employee avatar with a guaranteed fallback.
 *
 * WHY THE onError MATTERS. `photoUrl` holds Zoho People's `Photo_downloadUrl`, an OAuth-gated endpoint.
 * A browser `<img src>` carries no Zoho bearer, so it 401s and the slot renders as a broken-image glyph
 * — which is the "some images are not showing" report. Re-hosting the photos into our own storage is the
 * real fix; this component is the permanent safety net, so a dead URL degrades to initials instead of a
 * broken icon. It also covers the ordinary cases: no photo, a blank string, or a link that expires later.
 */
export function HrAvatar({
  name,
  photoUrl,
  size = 'md',
}: {
  name: string;
  photoUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [failed, setFailed] = useState(false);
  const src = (photoUrl ?? '').trim();
  const cls = `hr-avatar${size === 'sm' ? ' hr-avatar-sm' : size === 'lg' ? ' hr-avatar-lg' : ''}`;

  if (!src || failed) {
    // A deterministic tone per person, so the same colleague keeps the same colour across every screen.
    const tone = toneIndex(name);
    return (
      <span className={cls} data-tone={tone} aria-hidden="true">
        {initialsOf(name)}
      </span>
    );
  }
  return (
    <img
      className={cls}
      src={src}
      alt=""
      loading="lazy"
      // decoding async so a slow avatar never blocks the card grid paint.
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

/** Up to two initials from a display name. */
export function initialsOf(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

/** Stable 0–5 bucket from a name — same input, same colour, no persistence needed. */
function toneIndex(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) % 997;
  return h % 6;
}
