import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';

export type Theme = 'dark' | 'light';
const KEY = 'mytrion-theme';

function initial(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const saved = window.localStorage.getItem(KEY);
  return saved === 'light' || saved === 'dark' ? saved : 'dark';
}

/** Apply before paint so CSS `[data-theme]` and React theme state never desync for a frame. */
function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem(KEY, theme);
}

/**
 * Crossfade theme changes via View Transitions API when available.
 * flushSync so React paints the new theme inside the same transition frame.
 * @see https://developer.chrome.com/docs/web-platform/view-transitions
 */
function withThemeTransition(apply: () => void): void {
  const doc = document as Document & {
    startViewTransition?: (update: () => void) => { finished: Promise<void> };
  };
  if (
    typeof doc.startViewTransition === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    document.documentElement.classList.add('theme-vt');
    const vt = doc.startViewTransition(() => {
      flushSync(apply);
    });
    void vt.finished.finally(() => {
      document.documentElement.classList.remove('theme-vt');
    });
    return;
  }
  flushSync(apply);
}

interface ThemeContextType {
  theme: Theme;
  toggle: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initial);

  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    withThemeTransition(() => {
      applyTheme(next);
      setThemeState(next);
    });
  }, []);

  const toggle = useCallback(() => {
    withThemeTransition(() => {
      setThemeState((t) => {
        const next: Theme = t === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        return next;
      });
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggle, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** Theme state globally synced across all Mytrions. */
export function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
