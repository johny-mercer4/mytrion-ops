/**
 * One workspace tile.
 *
 * The old version carried ~200 lines of inline CSSProperties driven by a `hovered` useState, a
 * `dark` prop, and a 281-line lookup table of literal rgba per workspace (horizonGlass.ts). All of
 * that is gone: the card sets `data-mytrion`, the cascade supplies `--badge-tone`, and the CSS
 * derives the border, wash and glow from it with color-mix(). Hover is `:hover, :focus-visible`.
 *
 * That last part is a bug fix, not a refactor — every affordance used to hang off onMouseEnter, so
 * a keyboard user tabbing the grid got no feedback at all beyond the global focus ring.
 *
 * The one inline style left is `--stagger`, which cannot be a class: it is a per-index value.
 */
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { MytrionGlyph } from '../../components/icons';
import type { LauncherTile } from './launcherTiles';
import styles from './WorkspaceCard.module.css';

export function WorkspaceCard({
  tile,
  index,
  onEnter,
}: {
  tile: LauncherTile;
  index: number;
  onEnter: (id: string) => void;
}) {
  const body = (
    <>
      <span className={styles.chip} aria-hidden>
        <MytrionGlyph name={tile.icon} size={22} />
      </span>
      {tile.soon ? (
        <span className={styles.soon}>Coming soon</span>
      ) : (
        <ChevronRight size={18} className={styles.chevron} aria-hidden />
      )}
      <h3 className={styles.title}>{tile.title}</h3>
      <p className={styles.blurb}>{tile.blurb}</p>
      <span className={styles.tag}>{tile.tag}</span>
    </>
  );

  return (
    <li
      className={styles.cell}
      data-mytrion={tile.id}
      style={{ '--stagger': `${index * 0.06}s` } as CSSProperties}
    >
      {tile.soon || !tile.to ? (
        <div className={`${styles.card} ${styles.cardSoon}`} aria-disabled="true">
          {body}
        </div>
      ) : (
        <Link
          className={styles.card}
          to={tile.to}
          data-od-id={`mytrion-card-${tile.id}`}
          onClick={() => onEnter(tile.id)}
        >
          {body}
        </Link>
      )}
    </li>
  );
}
