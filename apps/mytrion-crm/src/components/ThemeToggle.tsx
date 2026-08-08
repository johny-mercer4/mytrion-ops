/**
 * The one theme control in the app.
 *
 * It used to be a `Theme` row inside the account menu, plus three hand-rolled copies — a sliding
 * sun/moon switch on the launcher, and a button each in the Billing and Customer Service shells.
 * Four controls for one preference, in four visual languages.
 *
 * Must render inside ThemeProvider: useTheme throws outside it, so a test harness that mounts the
 * header without the provider blanks the whole bar behind an error boundary.
 */
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

export function ThemeToggle({ className }: { className?: string | undefined }) {
  const { theme, toggle } = useTheme();
  const dark = theme !== 'light';
  return (
    <button
      type="button"
      className={className}
      onClick={toggle}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {dark ? <Moon size={17} /> : <Sun size={17} />}
    </button>
  );
}
