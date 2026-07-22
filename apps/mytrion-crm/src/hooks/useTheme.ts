/**
 * Stable entry for theme hooks/provider.
 * Keep this `.ts` path so Vite HMR graphs that resolved `./useTheme` → `.ts`
 * (before the provider moved into JSX) keep working after hard reloads.
 */
export { ThemeProvider, useTheme, type Theme } from './themeContext';
