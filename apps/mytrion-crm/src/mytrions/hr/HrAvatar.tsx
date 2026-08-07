import { useEffect, useState } from 'react';
import { getHrEmployeePhotoLink } from '../../api/hrPerson';

/**
 * Employee avatar: a re-hosted photo when there is one, initials otherwise.
 *
 * WHY A FILE ID AND NOT A URL. The row still carries Zoho People's `Photo_downloadUrl`, but that endpoint
 * is OAuth-gated — a browser `<img src>` has no Zoho bearer, so every one of them 401'd and the slot
 * rendered a broken-image glyph (the "some images are not showing" report). The API no longer sends it.
 * What it sends is `photoFileId`, pointing at our own copy in `file_assets` (Dropbox today), and this
 * component trades that id for a short-lived link.
 *
 * WHY THE LINK IS FETCHED, NOT EMBEDDED. A Dropbox link is a network round trip that Dropbox expires
 * after ~4h, so the directory cannot ship one per row: it would make listing 213 people 213 round trips
 * slower AND hand out URLs that die mid-session. Resolving here means we only pay for the faces that
 * actually render, and the cache below means one request per photo per session rather than one per
 * mount — the same person on a card, in the department modal and on the org canvas shares one fetch.
 *
 * The initials fallback is load-bearing, not decorative: it covers no photo, a photo still resolving, a
 * link that failed, and a link that expired while the tab sat open.
 */

/** Resolved links, keyed by FILE id — a new upload mints a new id, so this needs no invalidation. */
const linkCache = new Map<string, { url: string; expiresAtMs: number }>();
/** In-flight resolutions, so N avatars of the same person make one request, not N. */
const inFlight = new Map<string, Promise<string | null>>();

/** Re-resolve slightly early: a link that expires while the image is still loading renders as broken. */
const EXPIRY_MARGIN_MS = 5 * 60_000;
/** Used only if the server sends an unparseable expiry — short enough that the page self-heals. */
const FALLBACK_TTL_MS = 30 * 60_000;

function cachedPhotoUrl(fileId: string | null | undefined): string | null {
  if (!fileId) return null;
  const hit = linkCache.get(fileId);
  if (!hit) return null;
  if (hit.expiresAtMs - EXPIRY_MARGIN_MS <= Date.now()) {
    linkCache.delete(fileId);
    return null;
  }
  return hit.url;
}

async function resolvePhotoUrl(employeeId: string, fileId: string): Promise<string | null> {
  const cached = cachedPhotoUrl(fileId);
  if (cached) return cached;
  const pending = inFlight.get(fileId);
  if (pending) return pending;

  const request = getHrEmployeePhotoLink(employeeId)
    .then((link) => {
      const parsed = Date.parse(link.expiresAt);
      linkCache.set(fileId, {
        url: link.url,
        expiresAtMs: Number.isFinite(parsed) ? parsed : Date.now() + FALLBACK_TTL_MS,
      });
      return link.url;
    })
    // A 404 (photo removed between the list read and this fetch) or a transport blip is not worth a
    // banner over an avatar — initials are a correct answer to "we have no picture for this person".
    .catch(() => null)
    .finally(() => inFlight.delete(fileId));

  inFlight.set(fileId, request);
  return request;
}

/** Test seam: the cache is module state, so a suite would otherwise leak links between cases. */
export function resetHrAvatarCache(): void {
  linkCache.clear();
  inFlight.clear();
}

export function HrAvatar({
  name,
  employeeId,
  photoFileId,
  size = 'md',
}: {
  name: string;
  /** Whose photo — the link route is keyed by employee, not by file. */
  employeeId?: string | null;
  photoFileId?: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  // Seeded from the cache so an already-resolved face paints on the FIRST frame; going through the
  // effect instead would flash initials every time a card scrolled back into the grid.
  const [src, setSrc] = useState<string | null>(() => cachedPhotoUrl(photoFileId));
  const [failed, setFailed] = useState(false);
  const cls = `hr-avatar${size === 'sm' ? ' hr-avatar-sm' : size === 'lg' ? ' hr-avatar-lg' : ''}`;

  useEffect(() => {
    // Reset per source. Without this, an instance React reused for a DIFFERENT person — the detail
    // modal, a canvas node after a rebuild — stayed stuck on the previous person's failure and showed
    // initials for someone who does have a photo.
    setFailed(false);

    if (!employeeId || !photoFileId) {
      setSrc(null);
      return undefined;
    }
    const cached = cachedPhotoUrl(photoFileId);
    if (cached) {
      setSrc(cached);
      return undefined;
    }

    let cancelled = false;
    setSrc(null);
    void resolvePhotoUrl(employeeId, photoFileId).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [employeeId, photoFileId]);

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
      // A link that expired in a long-open tab: drop it from the cache too, or every later mount serves
      // the same dead URL for the rest of the session.
      onError={() => {
        if (photoFileId) linkCache.delete(photoFileId);
        setFailed(true);
      }}
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
