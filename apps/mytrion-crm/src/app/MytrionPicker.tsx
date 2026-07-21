import { Link, Navigate } from 'react-router-dom';
import { useUserContext } from '../context/UserContextProvider';
import { MYTRIONS, MYTRION_URL_SLUG, COMING_SOON_PICKER_TILES, type MytrionId } from '../access/mytrions.config';
import { TopBar } from '../components/TopBar';
import { MytrionGlyph } from '../components/icons';
import styles from './MytrionPicker.module.css';

/** Landing picker: hero + a grid of the Mytrions the user may enter. */
export function MytrionPicker({ ids }: { ids: MytrionId[] }) {
  const ctx = useUserContext();
  const count = ids.length;

  if (ids.length === 1) {
    return <Navigate to={`/main/${MYTRION_URL_SLUG[ids[0]!]}`} replace />;
  }

  return (
    <div className={styles.screen}>
      <TopBar showIdentity />
      <div className={styles.bgAmbient} aria-hidden="true" />
      <div className={styles.scroll}>
        <main className={styles.content}>
          <header className={styles.hero}>
            <div className={styles.eyebrow}>Choose your workspace</div>
            <h1 className={styles.title}>
              Welcome back, <span>{ctx.userName.split(' ')[0] || ctx.userName}</span>
            </h1>
            <p className={styles.lede}>
              You have access to {count} Mytrion{count === 1 ? '' : 's'}. Each is scoped to a
              department&rsquo;s data and grounded in its own knowledge base. Pick one to enter &mdash; you can
              switch any time.
            </p>
          </header>

          <ul className={styles.grid} role="list" aria-label="Available workspaces">
            {ids.map((id) => {
              const m = MYTRIONS[id];
              const hue = m.hue;
              return (
                <li key={id} className={styles.gridItem}>
                  <Link
                    className={styles.card}
                    to={`/main/${MYTRION_URL_SLUG[id]}`}
                    style={{ '--card-hue': `var(--${hue})` } as React.CSSProperties}
                    data-od-id={`mytrion-card-${id}`}
                  >
                    <span
                      className={styles.glyph}
                      style={{ background: `color-mix(in srgb, var(--${hue}) 15%, transparent)`, color: `var(--${hue})` }}
                      aria-hidden="true"
                    >
                      <MytrionGlyph name={m.icon} size={24} />
                    </span>
                    <div className={styles.cardTitle}>{m.title.replace(/ Mytrion$/, '')}</div>
                    <span className={styles.cardTag}>{m.tag}</span>
                  </Link>
                </li>
              );
            })}
            {COMING_SOON_PICKER_TILES.map((tile) => {
              const hue = tile.hue;
              return (
                <li key={tile.id} className={styles.gridItem}>
                  <div
                    className={`${styles.card} ${styles.cardSoon}`}
                    aria-disabled="true"
                    style={{ '--soon-hue': `var(--${hue})` } as React.CSSProperties}
                  >
                    <div className={styles.cardHead}>
                      <span
                        className={styles.glyph}
                        style={{ background: `color-mix(in srgb, var(--${hue}) 12%, transparent)`, color: `var(--${hue})` }}
                        aria-hidden="true"
                      >
                        <MytrionGlyph name={tile.icon} size={24} />
                      </span>
                      <span className={styles.soonBadge}>Coming soon</span>
                    </div>
                    <div className={styles.cardTitle}>{tile.title.replace(/ Mytrion$/, '')}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </main>
      </div>
    </div>
  );
}