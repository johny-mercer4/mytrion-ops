/**
 * Vitest for the web app — kept separate from vite.config.ts so the widget build config stays
 * untouched. Merges the app's vite config (react plugin, @ alias) with a jsdom test env.
 */
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  }),
);
