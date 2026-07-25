/**
 * Horizon workspace picker — glassmorphism port of `/Users/user/Desktop/HorizonNew`.
 * Same visual language; wired to live Mytrion access + Zoho session.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Building2, ChevronRight, Clock, LogOut, Moon, Sun, Zap } from 'lucide-react';
import { useUserContext } from '../context/UserContextProvider';
import {
  MYTRIONS,
  MYTRION_URL_SLUG,
  COMING_SOON_PICKER_TILES,
  type MytrionId,
} from '../access/mytrions.config';
import { logout } from '../api/auth';
import { useTheme } from '../hooks/useTheme';
import { MytrionGlyph } from '../components/icons';
import { glassFor, readLastWorkspace, rememberWorkspace } from './horizonGlass';
import styles from './MytrionPicker.module.css';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function displayName(title: string): string {
  return title.replace(/ Mytrion$/, '');
}

interface TileProps {
  id: string;
  title: string;
  blurb: string;
  tag: string;
  icon: string;
  hue: string;
  to?: string;
  soon?: boolean;
  dark: boolean;
}

/** Rewrites the alpha of an `rgba(r,g,b,a)` string, leaving the channels alone. */
function alpha(rgba: string, a: number): string {
  return rgba.replace(/[\d.]+\)$/, `${a})`);
}

/** Exact port of HorizonNew WorkspaceCard hover math. */
function WorkspaceCard({ id, title, blurb, tag, icon, hue, to, soon, dark }: TileProps) {
  const [hovered, setHovered] = useState(false);
  const g = glassFor(id, hue);
  const active = hovered && !soon;

  const glowColor = dark ? g.glow : g.glowLight;
  const iconColor = dark
    ? active
      ? g.iconHover
      : g.icon
    : active
      ? g.iconHoverLight
      : g.iconLight;
  const iconBg = dark
    ? active
      ? g.iconBgHover
      : g.iconBg
    : // Light: the chip is white glass over the card's tint, brightening to solid on hover.
      active
      ? 'rgba(255,255,255,1)'
      : 'rgba(255,255,255,0.88)';
  const iconBorder = dark
    ? active
      ? `1px solid ${alpha(g.glow, 0.55)}`
      : '1px solid rgba(255,255,255,0.1)'
    : active
      ? `1px solid ${g.borderHoverLight}`
      : `1px solid ${g.borderLight}`;

  const cardStyle: CSSProperties = {
    minHeight: 230,
    height: '100%',
    backdropFilter: 'blur(28px)',
    WebkitBackdropFilter: 'blur(28px)',
    background: dark
      ? active
        ? 'rgba(255,255,255,0.09)'
        : 'rgba(255,255,255,0.042)'
      : active
        ? g.cardBgHoverLight
        : g.cardBgLight,
    borderColor: dark
      ? active
        ? 'rgba(255,255,255,0.18)'
        : 'rgba(255,255,255,0.07)'
      : active
        ? g.borderHoverLight
        : g.borderLight,
    transform: active ? 'translateY(-4px) scale(1.006)' : 'translateY(0) scale(1)',
    boxShadow: active
      ? dark
        ? `0 24px 64px -12px ${glowColor}, 0 8px 24px rgba(0,0,0,0.5)`
        : // Light lift is neutral rather than hue-glowed (a coloured drop shadow on a pale pane
          // reads as a smudge) but it is SLATE, never black, and pulled in with a negative spread
          // so it diffuses instead of drawing a hard edge under the card.
          '0 12px 32px -10px rgba(30,41,59,0.14), 0 3px 10px -3px rgba(30,41,59,0.07)'
      : dark
        ? '0 2px 12px rgba(0,0,0,0.22)'
        : '0 1px 3px rgba(30,41,59,0.05)',
    transition:
      'background 0.5s ease, border-color 0.5s ease, transform 0.55s cubic-bezier(0.22,1,0.36,1), box-shadow 0.5s ease',
  };

  // Every shadow on the light chip is tinted with the workspace hue, never a neutral. A grey/black
  // shadow under a white chip sitting on a pale card is exactly what reads as a dirty smudge — and
  // the halo is pulled in with a negative spread so it stays a glow rather than a dark ring.
  const glyphRing = dark
    ? `0 0 0 1px ${alpha(glowColor, 0.2)}, 0 4px 22px ${alpha(glowColor, 0.5)}, inset 0 1px 0 rgba(255,255,255,0.2)`
    : `0 0 0 1px ${alpha(glowColor, 0.4)}, 0 6px 18px -4px ${alpha(glowColor, 0.5)}, inset 0 1px 0 rgba(255,255,255,0.95)`;

  const glyphStyle: CSSProperties = {
    background: iconBg,
    color: iconColor,
    border: iconBorder,
    boxShadow: active
      ? glyphRing
      : dark
        ? 'inset 0 1px 0 rgba(255,255,255,0.08)'
        : `inset 0 1px 0 rgba(255,255,255,0.85), 0 1px 3px ${alpha(glowColor, 0.14)}`,
    transition: 'background 0.45s ease, color 0.45s ease, border 0.45s ease, box-shadow 0.45s ease',
  };

  const badgeKey = (dark ? g.badgeClass : g.badgeLight) as keyof typeof styles;
  const badgeClass = `${styles.badge} ${styles[badgeKey] ?? ''}`;

  const body = (
    <>
      <div
        className={styles.cardGlow}
        style={{
          background: `radial-gradient(ellipse at 50% 0%, ${glowColor}, transparent 65%)`,
          opacity: active ? 1 : 0,
          transition: 'opacity 0.45s ease',
        }}
      />
      <div
        className={`${styles.card} ${soon ? styles.cardSoon : ''}`}
        style={cardStyle}
      >
        {dark ? (
          <div
            className={styles.cardGrad}
            style={{
              background: g.gradient,
              opacity: active ? 0.45 : 0.25,
              transition: 'opacity 0.35s ease',
            }}
          />
        ) : (
          <>
            {/* Frosted base — INCREASES on hover, so the pane gets glassier as you approach while
                the hue below saturates: the card lights up rather than clouding over. Held below
                the reference's 0.78 top stop, which pushed the pane to near-opaque white and blew
                the hue straight back out again. */}
            <div
              className={styles.cardFrost}
              style={{
                background: `linear-gradient(140deg, rgba(255,255,255,${active ? '0.62' : '0.44'}) 0%, rgba(255,255,255,${active ? '0.14' : '0.05'}) 100%)`,
                transition: 'background 0.35s ease',
              }}
            />
            {/* Colour wash — near-invisible at rest, fully vivid on hover. */}
            <div
              className={styles.cardGrad}
              style={{
                background: g.gradientLight,
                opacity: active ? 1 : 0.45,
                transition: 'opacity 0.35s ease',
              }}
            />
            {/* Specular corner catch — the highlight that sells it as a physical pane. Kept under
                0.5 so it stays a catch of light and not a second white blowout in the corner. */}
            <div
              className={styles.cardSpecular}
              style={{
                background: `radial-gradient(ellipse at 18% 18%, rgba(255,255,255,${active ? '0.46' : '0.24'}), transparent 68%)`,
                transition: 'background 0.35s ease',
              }}
            />
            <div
              className={styles.cardBottomGlow}
              style={{
                background: `radial-gradient(ellipse at 80% 90%, ${alpha(glowColor, 0.18)}, transparent 70%)`,
                opacity: active ? 1 : 0,
                transition: 'opacity 0.4s ease',
              }}
            />
          </>
        )}
        <div
          className={styles.cardShimmer}
          style={{
            opacity: active ? 1 : 0,
            transition: 'opacity 0.32s ease',
            background: dark
              ? 'linear-gradient(90deg, transparent 8%, rgba(255,255,255,0.35) 50%, transparent 92%)'
              : 'linear-gradient(90deg, transparent 8%, rgba(255,255,255,0.98) 50%, transparent 92%)',
          }}
        />

        <div className={styles.cardTop}>
          {/* .glyphLit adds `drop-shadow(0 0 4px currentColor)` to the stroke — the icon itself
              glows in its own hue on hover, which is the reference's `.icon-draw.drawn` rule. */}
          <span
            className={`${styles.glyph} ${active ? styles.glyphLit : ''}`}
            style={glyphStyle}
            aria-hidden="true"
          >
            <MytrionGlyph name={icon} size={26} />
          </span>
          {soon ? (
            <span className={styles.soonBadge}>Coming soon</span>
          ) : (
            <ChevronRight
              size={14}
              strokeWidth={1.6}
              aria-hidden
              style={{
                color: dark ? 'rgba(200,210,255,0.55)' : 'rgba(80,100,140,0.45)',
                marginTop: 2,
                flexShrink: 0,
                opacity: active ? 1 : 0.3,
                transform: active ? 'translateX(3px)' : 'translateX(0)',
                transition: 'transform 0.28s ease, opacity 0.28s ease',
              }}
            />
          )}
        </div>

        <div className={styles.cardBody}>
          {/* Fixed ink in both themes. Recolouring the title on hover made the hue read twice
              (chip + heading) and left the card with no stable anchor. */}
          <h3 className={styles.cardTitle}>{displayName(title)}</h3>
          <p className={styles.cardBlurb}>{blurb}</p>
        </div>

        <span className={badgeClass}>{tag}</span>
      </div>
    </>
  );

  if (soon || !to) {
    return (
      <li>
        <div
          className={`${styles.cardWrap} ${styles.cardWrapSoon}`}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          aria-disabled="true"
        >
          {body}
        </div>
      </li>
    );
  }

  return (
    <li>
      <Link
        className={styles.cardWrap}
        to={to}
        data-od-id={`mytrion-card-${id}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => rememberWorkspace(displayName(title))}
      >
        {body}
      </Link>
    </li>
  );
}

function StatTile({
  icon,
  value,
  label,
  accent,
  bg,
  border,
  glow,
  dark,
}: {
  icon: ReactNode;
  value: string;
  label: string;
  accent: string;
  bg: string;
  border: string;
  glow: string;
  dark: boolean;
}) {
  return (
    <div
      className={styles.stat}
      style={{
        background: bg,
        border: `1px solid ${border}`,
        boxShadow: dark
          ? `0 4px 24px -4px ${glow}, inset 0 1px 0 rgba(255,255,255,0.06)`
          : `0 4px 20px -4px ${glow}, inset 0 1px 0 rgba(255,255,255,0.8)`,
      }}
    >
      <div
        className={styles.statIcon}
        style={{
          background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.7)',
          border: `1px solid ${border}`,
          color: accent,
          boxShadow: `0 0 12px ${glow}`,
        }}
      >
        {icon}
      </div>
      <span
        className={styles.statValue}
        style={{ color: accent, textShadow: dark ? `0 0 20px ${glow}` : 'none' }}
      >
        {value}
      </span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

/** Landing picker: Horizon glass UI + accessible Mytrion grid. */
export function MytrionPicker({ ids }: { ids: MytrionId[] }) {
  const ctx = useUserContext();
  const { theme, toggle } = useTheme();
  const dark = theme !== 'light';
  const firstName = ctx.userName.split(' ')[0] || ctx.userName;
  const last = readLastWorkspace();

  const liveTiles = useMemo(
    () =>
      ids.map((id) => {
        const m = MYTRIONS[id];
        return {
          id,
          title: m.title,
          blurb: m.blurb,
          tag: m.tag.toUpperCase(),
          icon: m.icon,
          hue: m.hue,
          to: `/main/${MYTRION_URL_SLUG[id]}`,
        };
      }),
    [ids],
  );

  const soonTiles = useMemo(
    () =>
      COMING_SOON_PICKER_TILES.filter((t) => !ids.includes(t.id as MytrionId)).map((t) => {
        const live = (MYTRIONS as Record<string, (typeof MYTRIONS)[MytrionId]>)[t.id];
        return {
          id: t.id,
          title: t.title,
          blurb: live?.blurb ?? 'Workspace in progress — opening soon.',
          tag: (live?.tag ?? 'Soon').toUpperCase(),
          icon: t.icon,
          hue: t.hue,
          soon: true as const,
        };
      }),
    [ids],
  );

  const totalShown = liveTiles.length + soonTiles.length;

  if (ids.length === 1) {
    return <Navigate to={`/main/${MYTRION_URL_SLUG[ids[0]!]}`} replace />;
  }

  return (
    <div className={styles.screen}>
      <div className={styles.mesh} aria-hidden="true">
        <div className={styles.meshGrad} />
        <div className={styles.meshGrid} />
        <div className={styles.meshVignette} />
      </div>

      <div className={styles.navShell}>
        <header className={styles.nav}>
          <div className={styles.wordmark} aria-label="Mytrion Horizon">
            <span className={styles.gradMytrion}>MYTRION</span>
            <span className={styles.gradHorizon}>HORIZON</span>
          </div>

          <div className={styles.navRight}>
            <button
              type="button"
              className={styles.themeToggle}
              onClick={toggle}
              title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle theme"
              style={{
                background: dark
                  ? 'linear-gradient(135deg, rgba(30,27,75,0.9) 0%, rgba(49,46,129,0.85) 100%)'
                  : 'linear-gradient(135deg, rgba(219,234,254,0.85) 0%, rgba(224,242,254,0.8) 100%)',
                border: dark
                  ? '1px solid rgba(165,180,252,0.35)'
                  : '1px solid rgba(99,102,241,0.22)',
                boxShadow: dark
                  ? '0 0 14px rgba(99,102,241,0.28), inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -1px 0 rgba(0,0,0,0.2)'
                  : '0 0 10px rgba(14,165,233,0.18), inset 0 1px 0 rgba(255,255,255,0.8), inset 0 -1px 0 rgba(0,0,0,0.05)',
              }}
            >
              <Moon
                size={11}
                aria-hidden
                style={{
                  position: 'absolute',
                  left: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  zIndex: 0,
                  color: dark ? '#c7d2fe' : '#6366f1',
                  opacity: dark ? 1 : 0.5,
                  transition: 'opacity 0.45s cubic-bezier(0.22,1,0.36,1), color 0.45s cubic-bezier(0.22,1,0.36,1)',
                  pointerEvents: 'none',
                  filter: dark ? 'drop-shadow(0 0 4px rgba(165,180,252,0.8))' : 'none',
                }}
              />
              <Sun
                size={11}
                aria-hidden
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  zIndex: 0,
                  color: dark ? '#fbbf24' : '#f59e0b',
                  opacity: dark ? 0.5 : 1,
                  transition: 'opacity 0.45s cubic-bezier(0.22,1,0.36,1), color 0.45s cubic-bezier(0.22,1,0.36,1)',
                  pointerEvents: 'none',
                  filter: dark ? 'none' : 'drop-shadow(0 0 4px rgba(251,191,36,0.7))',
                }}
              />
              <span
                className={styles.themeKnob}
                style={{
                  transform: dark ? 'translateX(0)' : 'translateX(28px)',
                  background: dark
                    ? 'linear-gradient(135deg, #a5b4fc, #818cf8, #6366f1)'
                    : 'linear-gradient(135deg, #fef3c7, #fde68a, #fbbf24)',
                  boxShadow: dark
                    ? '0 2px 8px rgba(99,102,241,0.65), 0 0 0 1px rgba(165,180,252,0.3)'
                    : '0 2px 8px rgba(251,191,36,0.5), 0 0 0 1px rgba(253,230,138,0.5)',
                }}
              />
            </button>

            <div className={styles.navDivider} aria-hidden />

            <div className={styles.userBlock}>
              <div className={styles.userText}>
                <div className={styles.userName}>{ctx.userName}</div>
                <div className={styles.userRole}>{ctx.role || ctx.profile}</div>
              </div>
              <span className={styles.avatar} title={ctx.userName}>
                {initials(ctx.userName)}
              </span>
            </div>

            {ctx.trusted && (
              <button type="button" className={styles.signOut} onClick={logout} title="Sign out">
                <LogOut size={11} strokeWidth={1.5} />
                Sign out
              </button>
            )}
          </div>
        </header>
      </div>

      <div className={styles.scroll}>
        <main className={styles.content}>
          <header className={styles.hero}>
            <div className={styles.eyebrow}>
              <span className={styles.pulseDot} aria-hidden />
              Choose Your Workspace
            </div>
            <h1 className={styles.title}>
              Welcome back, <span className={styles.titleName}>{firstName}</span>
            </h1>

            <div className={styles.stats}>
              <StatTile
                dark={dark}
                icon={<Zap size={16} strokeWidth={1.8} />}
                value={String(liveTiles.length)}
                label="Active Workspaces"
                accent={dark ? '#818cf8' : '#6366f1'}
                bg={dark ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.07)'}
                border={dark ? 'rgba(99,102,241,0.25)' : 'rgba(99,102,241,0.18)'}
                glow="rgba(99,102,241,0.3)"
              />
              <StatTile
                dark={dark}
                icon={<Building2 size={16} strokeWidth={1.8} />}
                value={String(totalShown)}
                label="Departments"
                accent={dark ? '#67e8f9' : '#0891b2'}
                bg={dark ? 'rgba(14,165,233,0.09)' : 'rgba(14,165,233,0.06)'}
                border={dark ? 'rgba(14,165,233,0.22)' : 'rgba(14,165,233,0.16)'}
                glow="rgba(14,165,233,0.28)"
              />
              <StatTile
                dark={dark}
                icon={<Clock size={16} strokeWidth={1.8} />}
                value={last ?? displayName(MYTRIONS[ids[0]!]?.title ?? '—')}
                label="Last Active"
                accent={dark ? '#fbbf24' : '#d97706'}
                bg={dark ? 'rgba(245,158,11,0.09)' : 'rgba(245,158,11,0.06)'}
                border={dark ? 'rgba(245,158,11,0.22)' : 'rgba(245,158,11,0.16)'}
                glow="rgba(245,158,11,0.28)"
              />
            </div>
          </header>

          <section>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>All Workspaces</h2>
              <div className={styles.sectionLine} />
              <span className={styles.sectionCount}>{liveTiles.length} active</span>
            </div>

            <ul className={styles.grid} role="list" aria-label="Available workspaces">
              {liveTiles.map((t) => (
                <WorkspaceCard key={t.id} {...t} dark={dark} />
              ))}
              {soonTiles.map((t) => (
                <WorkspaceCard key={t.id} {...t} dark={dark} soon />
              ))}
            </ul>
          </section>

          <footer className={styles.footer}>
            <span className={styles.footerNote}>© {new Date().getFullYear()} Mytrion Horizon. Internal use only.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
