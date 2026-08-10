import { useEffect, useState, type ReactNode } from 'react';
import styles from './KitchenShell.module.css';

/**
 * The kitchen-sink harness: chrome only, no components of its own.
 *
 * Its job is to make every design-system component reviewable in BOTH THEMES SIDE BY SIDE without
 * a backend, a session, or a route guard. That is why it lives at /kitchen outside the auth gate
 * and imports nothing from the app — if reviewing the design system required logging in and
 * navigating to the one screen that happens to use a component, nobody would review it.
 *
 * The split view is the point. Horizon's light and dark modes are first-class and independently
 * specified (dark elevates with light, light elevates with shadow), so a component that looks
 * right in one and wrong in the other is the single most likely defect — and it is invisible if
 * you can only see one at a time.
 */

export function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return (
    <section className={styles.section} id={id}>
      <header className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {subtitle ? <p className={styles.sectionSub}>{subtitle}</p> : null}
      </header>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

/** One labelled specimen. The label is what makes a screenshot diff reviewable. */
export function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.specimen}>
      <div className={styles.specimenLabel}>{label}</div>
      <div className={styles.specimenBody}>{children}</div>
    </div>
  );
}

/** A row of specimens — the default layout for a variant matrix. */
export function Row({ children }: { children: ReactNode }) {
  return <div className={styles.row}>{children}</div>;
}

/**
 * Renders its children twice — once forced light, once forced dark.
 *
 * `data-theme` is set on a WRAPPER rather than on <html>, which works because every Horizon token
 * resolves through the custom-property cascade rather than through a `dark:` variant. That design
 * decision is what makes this side-by-side view possible at all; a class-based dark mode could not
 * do it without rendering the page twice in iframes.
 */
export function ThemePair({ children }: { children: ReactNode }) {
  return (
    <div className={styles.pair}>
      <div className={styles.pane} data-theme="light">
        <div className={styles.paneTag}>light</div>
        <div className={styles.paneBody}>{children}</div>
      </div>
      <div className={styles.pane} data-theme="dark">
        <div className={styles.paneTag}>dark</div>
        <div className={styles.paneBody}>{children}</div>
      </div>
    </div>
  );
}

export function KitchenShell({ children, sections }: { children: ReactNode; sections: string[] }) {
  const [split, setSplit] = useState(true);

  // The harness owns <html data-theme> only while it is mounted, and restores whatever the app had
  // on the way out — a review tool that silently changes the user's theme preference is a bug.
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-theme');
    return () => {
      if (previous === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', previous);
    };
  }, []);

  return (
    <div className={styles.root}>
      <header className={styles.masthead}>
        <div>
          <h1 className={styles.title}>Mytrion Horizon</h1>
          <p className={styles.sub}>Design system — every component, every state, both themes</p>
        </div>
        <label className={styles.toggle}>
          <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} />
          Side-by-side themes
        </label>
      </header>

      <div className={styles.layout}>
        <nav className={styles.nav} aria-label="Components">
          <ol className={styles.navList}>
            {sections.map((s) => (
              <li key={s}>
                <a className={styles.navLink} href={`#${s.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
                  {s}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <main className={styles.main} data-split={split || undefined}>
          {children}
        </main>
      </div>
    </div>
  );
}
