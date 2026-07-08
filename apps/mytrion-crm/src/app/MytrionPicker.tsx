import { Link } from 'react-router-dom';
import { useUserContext } from '../context/UserContextProvider';
import { MYTRIONS, type MytrionId } from '../access/mytrions.config';
import { TopBar } from '../components/TopBar';
import { ArrowRightIcon, CheckIcon, MytrionGlyph } from '../components/icons';
import styles from './MytrionPicker.module.css';

const HUE_VAR: Record<string, string> = {
  accent: '--accent',
  success: '--success',
  purple: '--purple',
  orange: '--orange',
  danger: '--danger',
};

/** Landing picker (design 1a): hero + a grid of the Mytrions the user may enter. */
export function MytrionPicker({ ids }: { ids: MytrionId[] }) {
  const ctx = useUserContext();
  const count = ids.length;

  return (
    <div className={styles.screen}>
      <TopBar showIdentity />
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
            <div className={styles.tags}>
              <span className={styles.accessTag}>
                <CheckIcon size={11} />
                {ctx.profile} · access
              </span>
              <span className={styles.mono}>role: {ctx.role || '—'}</span>
              <span className={styles.mono}>uid: {ctx.userId}</span>
            </div>
          </header>

          <ul className={styles.grid}>
            {ids.map((id) => {
              const m = MYTRIONS[id];
              const hue = HUE_VAR[m.hue] ?? '--accent';
              return (
                <li key={id}>
                  <Link className={styles.card} to={`/m/${id}`}>
                    <div className={styles.cardTop}>
                      <span
                        className={styles.glyph}
                        style={{ background: `color-mix(in srgb, var(${hue}) 14%, transparent)`, color: `var(${hue})` }}
                      >
                        <MytrionGlyph name={m.icon} size={22} />
                      </span>
                      <span className={`${styles.badge} ${m.status === 'ported' ? styles.ported : styles.new}`}>
                        {m.status === 'ported' ? 'Ported' : 'New'}
                      </span>
                    </div>
                    <div>
                      <div className={styles.cardTitle}>{m.title.replace(/ Mytrion$/, '')}</div>
                      <div className={styles.cardDept}>
                        {m.allDepartments ? `${m.department} · all departments` : m.department}
                      </div>
                    </div>
                    <p className={styles.blurb}>{m.blurb}</p>
                    <span className={styles.enter}>
                      Enter <ArrowRightIcon size={12} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
