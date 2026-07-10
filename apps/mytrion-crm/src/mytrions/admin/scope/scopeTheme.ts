/**
 * Octane Scope — scene theme tokens. The scene runs its own cinematic palette
 * (much deeper than the app surface tokens) keyed off the shell's <html data-theme>,
 * exposed to the tree as CSS custom props on .oct-root.
 */
import { useEffect, useState } from 'react';

export interface SceneTokens {
  bg0: string;
  bg1: string;
  ink: string;
  sub: string;
  line: string;
  glass: string;
  gb: string;
  haze: string;
  noteglass: string;
}

export const SCENE_DARK: SceneTokens = {
  bg0: '#04060b',
  bg1: '#0a0f1a',
  ink: '#E8EDF6',
  sub: '#8893A8',
  line: 'rgba(255,255,255,.08)',
  glass: 'rgba(16,22,34,.62)',
  gb: 'rgba(255,255,255,.12)',
  haze: 'rgba(20,30,55,.5)',
  noteglass: 'rgba(12,17,28,.78)',
};

export const SCENE_LIGHT: SceneTokens = {
  bg0: '#EEF1F6',
  bg1: '#FAFBFE',
  ink: '#161A24',
  sub: '#5B6577',
  line: 'rgba(0,0,0,.08)',
  glass: 'rgba(255,255,255,.72)',
  gb: 'rgba(0,0,0,.12)',
  haze: 'rgba(180,195,225,.5)',
  noteglass: 'rgba(255,255,255,.85)',
};

/**
 * The current shell theme, live. The TopBar toggle owns <html data-theme>
 * (see useTheme); this observes the attribute so the scene follows without
 * threading extra props through the Mytrion shell.
 */
export function useDocumentTheme(): 'dark' | 'light' {
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    document.documentElement.dataset['theme'] === 'light' ? 'light' : 'dark',
  );

  useEffect(() => {
    const el = document.documentElement;
    const observer = new MutationObserver(() => {
      setTheme(el.dataset['theme'] === 'light' ? 'light' : 'dark');
    });
    observer.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return theme;
}
