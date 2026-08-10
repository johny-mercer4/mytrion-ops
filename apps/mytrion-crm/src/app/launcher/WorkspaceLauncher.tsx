/**
 * The launcher at /main — the front door.
 *
 * Replaces MytrionPicker, which was a sixth shell: its own header, its own hand-rolled sliding
 * theme switch, its own avatar and sign-out, its own mesh, and a 281-line table of per-workspace
 * rgba. All of that chrome is now the shared AppHeader, and the colour comes from the same
 * `--badge-tone` the workspace's own header badge reads — so the card you click and the workspace
 * you land in can no longer disagree, which they did for Billing, Collection and CS.
 *
 * Landing guarantees ids.length >= 2 here: zero is a 403, one auto-enters.
 */
import { useMemo, useState } from 'react';
import { Building2, Clock, IdCard } from 'lucide-react';
import { MYTRIONS, MYTRION_ORDER, MYTRION_URL_SLUG, type MytrionId } from '../../access/mytrions.config';
import { useUserContext } from '../../context/UserContextProvider';
import { AppHeader } from '../../components/AppHeader';
import { buildTiles, filterTiles } from './launcherTiles';
import { readLastWorkspace, rememberWorkspace } from './lastWorkspace';
import { StatCard } from './StatCard';
import { WorkspaceCard } from './WorkspaceCard';
import styles from './WorkspaceLauncher.module.css';

export function WorkspaceLauncher({ ids }: { ids: MytrionId[] }) {
  const ctx = useUserContext();
  const [query, setQuery] = useState('');
  const firstName = ctx.userName.split(' ')[0] || ctx.userName;

  const tiles = useMemo(() => buildTiles(ids), [ids]);
  const visible = useMemo(() => filterTiles(tiles, query), [tiles, query]);
  const last = readLastWorkspace();

  return (
    <div className={styles.screen}>
      <div className={`hzMesh ${styles.mesh}`} aria-hidden />

      {/* identity="full": no rail here, and identity must appear exactly once per surface. */}
      <AppHeader
        identity="full"
        search={{
          placeholder: 'Search the Horizon ecosystem…',
          value: query,
          onChange: setQuery,
          resultLabel: `${visible.length} of ${tiles.length} workspaces shown`,
        }}
      />

      <div className={styles.scroll}>
        <main className={styles.content}>
          <header className={styles.hero}>
            <p className={styles.eyebrow}>
              <span className={styles.pulse} aria-hidden />
              Choose your workspace
            </p>
            <h1 className={styles.title}>
              Welcome back, <span className={styles.name}>{firstName}</span>
            </h1>

            <div className={styles.stats}>
              <StatCard
                kind="access"
                icon={<Building2 size={22} strokeWidth={1.6} />}
                value={`${ids.length} of ${MYTRION_ORDER.length}`}
                label="Workspaces you can reach"
              />
              <StatCard
                kind="role"
                icon={<IdCard size={22} strokeWidth={1.6} />}
                value={ctx.role || ctx.profile || '—'}
                label="Your role"
              />
              {/*
                This replaces a "Departments" stat that rendered the IDENTICAL number to the one
                beside it on every load — COMING_SOON_PICKER_TILES derives from an empty array, so
                the total and the accessible count were provably the same, and every department
                slug is distinct so counting them changes nothing.
              */}
              <StatCard
                kind="last"
                icon={<Clock size={22} strokeWidth={1.6} />}
                value={last ? MYTRIONS[last].title.replace(/ Mytrion$/, '') : '—'}
                label="Last active"
                to={last ? `/main/${MYTRION_URL_SLUG[last]}` : undefined}
              />
            </div>
          </header>

          <section aria-labelledby="all-workspaces">
            <div className={styles.sectionHead}>
              <h2 id="all-workspaces" className={styles.sectionTitle}>
                All workspaces
              </h2>
              <span className={styles.rule} aria-hidden />
              <span className={styles.count}>{visible.length} shown</span>
            </div>

            {visible.length === 0 ? (
              <p className={styles.empty}>
                No workspace matches “{query.trim()}”. Try a department name like{' '}
                <strong>Billing</strong>, or clear the search.
              </p>
            ) : (
              <ul className={styles.grid}>
                {visible.map((tile, i) => (
                  <WorkspaceCard
                    key={tile.id}
                    tile={tile}
                    index={i}
                    onEnter={(id) => rememberWorkspace(id as MytrionId)}
                  />
                ))}
              </ul>
            )}
          </section>

          <footer className={styles.footer}>
            © {new Date().getFullYear()} Mytrion Horizon. Internal use only.
          </footer>
        </main>
      </div>
    </div>
  );
}
