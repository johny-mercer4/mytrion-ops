/**
 * The launcher's view models. Kept out of the component so the filter is testable without a DOM.
 */
import {
  MYTRIONS,
  MYTRION_URL_SLUG,
  COMING_SOON_PICKER_TILES,
  type MytrionId,
} from '../../access/mytrions.config';

export interface LauncherTile {
  id: string;
  /** "Sales", not "Sales Mytrion" — the suffix is a badge, not part of the name. */
  title: string;
  blurb: string;
  tag: string;
  icon: string;
  to?: string;
  soon?: boolean;
}

function displayName(title: string): string {
  return title.replace(/ Mytrion$/, '');
}

export function buildTiles(ids: MytrionId[]): LauncherTile[] {
  const live: LauncherTile[] = ids.map((id) => {
    const m = MYTRIONS[id];
    return {
      id,
      title: displayName(m.title),
      blurb: m.blurb,
      tag: m.tag.toUpperCase(),
      icon: m.icon,
      to: `/main/${MYTRION_URL_SLUG[id]}`,
    };
  });

  // COMING_SOON_PICKER_TILES derives from COMING_SOON_MYTRION_IDS, which is currently `[]`, so this
  // is dead today. The path stays because turning a workspace on is a one-line config change.
  const soon: LauncherTile[] = COMING_SOON_PICKER_TILES.filter(
    (t) => !ids.includes(t.id as MytrionId),
  ).map((t) => {
    const live = (MYTRIONS as Record<string, (typeof MYTRIONS)[MytrionId]>)[t.id];
    return {
      id: t.id,
      title: displayName(t.title),
      blurb: live?.blurb ?? 'Workspace in progress — opening soon.',
      tag: (live?.tag ?? 'Soon').toUpperCase(),
      icon: t.icon,
      soon: true,
    };
  });

  return [...live, ...soon];
}

/** Title, blurb and tag — the three things visible on the card, so a match is always explicable. */
export function filterTiles(tiles: LauncherTile[], query: string): LauncherTile[] {
  const q = query.trim().toLowerCase();
  if (!q) return tiles;
  return tiles.filter((t) =>
    `${t.title} ${t.blurb} ${t.tag}`.toLowerCase().includes(q),
  );
}
