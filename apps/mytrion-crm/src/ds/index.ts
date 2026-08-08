/**
 * Mytrion Horizon — the design system's public surface.
 *
 * This barrel is the entry point for the library build (vite.lib.config.ts -> dist/), which is what
 * makes the system portable: an engineer imports `@/ds`, and a design tool binds the same compiled
 * bundle. Everything exported here obeys the purity contract in ./purity.test.ts — props in,
 * nothing else. No app context, no router, no data layer.
 *
 * Tokens are NOT exported from here. They are CSS custom properties in src/styles/theme.css and
 * arrive through the stylesheet, which is why a consumer needs both the bundle and the CSS.
 */

export { Icon } from './Icon/Icon';
export type { IconProps, IconName } from './Icon/Icon';

export { Button } from './Button/Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button/Button';
