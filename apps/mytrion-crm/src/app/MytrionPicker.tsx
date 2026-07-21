import { Link } from 'react-router-dom';
import { useUserContext } from '../context/UserContextProvider';
import { MYTRIONS, MYTRION_URL_SLUG, COMING_SOON_PICKER_TILES, type MytrionId } from '../access/mytrions.config';
import { TopBar } from '../components/TopBar';
import { MytrionGlyph } from '../components/icons';
import styles from './MytrionPicker.module.css';

const HUE_VAR: Record<string, string> = {
  accent: '--accent',
  success: '--success',
  purple: '--purple',
  orange: '--orange',
  danger: '--danger',
  warning: '--warning',
  black: '--black',
  blue: '--blue',
  red: '--red',
  green: '--green',
  yellow: '--yellow',
  'dark-purple': '--dark-purple',
  'light-blue': '--light-blue',
  rocket: '--rocket',
};

/** Landing picker (design 1a): hero + a grid of the Mytrions the user may enter. */
export function MytrionPicker({ ids }: { ids: MytrionId[] }) {
  const ctx = useUserContext();
  const count = ids.length;

  return (
    <div className={styles.screen}>
      <TopBar showIdentity />
      <div className={styles.bgAmbient} aria-hidden="true">
        <div className={styles.bgOrb1} />
        <div className={styles.bgOrb2} />
      </div>
      <div className={styles.scroll}>
        <div className={styles.content}>
          <header className={styles.hero}>
            <div className={styles.eyebrow}>Choose your workspace</div>
            <h1 className={styles.title}>Welcome back, {ctx.userName.split(' ')[0] || ctx.userName}</h1>
            <p className={styles.lede}>
              You have access to {count} Mytrion{count === 1 ? '' : 's'}. Each is scoped to a
              department's data and grounded in its own knowledge base. Pick one to enter — you can
              switch any time.
            </p>

          </header>

          <ul className={styles.grid}>
            {ids.map((id, index) => {
              const m = MYTRIONS[id];
              const hue = HUE_VAR[m.hue] ?? '--accent';
              return (
                <li key={id}>
                  <Link 
                    className={`${styles.card} ${styles.dynamicHover}`} 
                    to={`/main/${MYTRION_URL_SLUG[id]}`}
                    style={{ 
                      '--card-hue': `var(${hue})`,
                      animationDelay: `${index * 0.05}s`
                    } as React.CSSProperties}
                  >
                    <span
                      className={styles.glyph}
                      style={{ background: `color-mix(in srgb, var(${hue}) 14%, transparent)`, color: `var(${hue})` }}
                    >
                      <MytrionGlyph name={m.icon} size={22} />
                    </span>
                    <div className={styles.cardTitle}>{m.title.replace(/ Mytrion$/, '')}</div>
                  </Link>
                </li>
              );
            })}
            {COMING_SOON_PICKER_TILES.map((tile, i) => {
              const index = ids.length + i;
              const hue = HUE_VAR[tile.hue] ?? '--accent';
              return (
                <li key={tile.id}>
                  <div
                    className={`${styles.card} ${styles.cardSoon}`}
                    aria-disabled="true"
                    style={
                      {
                        animationDelay: `${index * 0.05}s`,
                        '--soon-hue': `var(${hue})`,
                      } as React.CSSProperties
                    }
                  >
                    <div className={styles.cardHead}>
                      <span
                        className={styles.glyph}
                        style={{ background: `color-mix(in srgb, var(${hue}) 14%, transparent)`, color: `var(${hue})` }}
                      >
                        <MytrionGlyph name={tile.icon} size={22} />
                      </span>
                      <span className={styles.soonBadge}>Coming soon</span>
                    </div>
                    <div className={styles.cardTitle}>{tile.title.replace(/ Mytrion$/, '')}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
