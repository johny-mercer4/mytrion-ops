import { Link } from 'react-router-dom';
import { useUserContext } from '../context/UserContextProvider';
import { MYTRIONS, type MytrionId } from '../access/mytrions.config';
import styles from './MytrionPicker.module.css';

/** Grid of cards for the Mytrions a multi-access user (e.g. an admin) may enter. */
export function MytrionPicker({ ids }: { ids: MytrionId[] }) {
  const ctx = useUserContext();
  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>Choose a Mytrion</h1>
        <p className={styles.sub}>Signed in as {ctx.userName}</p>
      </header>
      <ul className={styles.grid}>
        {ids.map((id) => {
          const m = MYTRIONS[id];
          return (
            <li key={id}>
              <Link className={styles.card} to={`/m/${id}`}>
                <span className={styles.icon} aria-hidden>
                  {m.icon}
                </span>
                <span className={styles.cardTitle}>{m.title}</span>
                <span className={styles.blurb}>{m.blurb}</span>
                {m.status === 'new' && <span className={styles.tag}>skeleton</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
