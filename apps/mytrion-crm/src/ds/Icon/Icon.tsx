import type { CSSProperties } from 'react';
import { CODEPOINTS, type IconName } from './codepoints';
import styles from './Icon.module.css';

export type { IconName };

export interface IconProps {
  /**
   * A Material Symbols Sharp name, restricted to the icons in `src/styles/icon-map.json`.
   * The type is generated from the subset, so an icon that is not in the font cannot be spelled —
   * which is the point: a name outside the subset would render nothing at all.
   */
  name: IconName;
  /** 20px (default) or 16px. There is no third size; a third size is how icon scales drift. */
  size?: 'md' | 'sm';
  /**
   * The FILL axis. `false` is the idle outline, `true` the solid. Use it for SELECTED state —
   * an active rail row, a toggled control — not for emphasis.
   */
  filled?: boolean;
  /**
   * Accessible name. Provide it when the icon IS the control's meaning (an icon-only button, a
   * status glyph carrying information). OMIT it when the icon merely decorates adjacent text —
   * the icon is then hidden from assistive tech, so a screen reader hears the label once rather
   * than twice.
   */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * The one icon component. Material Symbols Sharp, wght 300, one family app-wide.
 *
 * WHY A CODEPOINT AND NOT A LIGATURE: Material Symbols normally resolves names through ligatures —
 * `<span>refresh</span>` becomes a glyph once the font arrives. Before it arrives, that span paints
 * the literal word "refresh". Addressing the codepoint directly means an unloaded font paints
 * nothing (the face is `font-display: block`), which is the correct failure for a glyph.
 *
 * Colour comes from `currentColor`, so an icon takes the tone of whatever it sits in and never
 * needs a colour prop.
 */
export function Icon({ name, size = 'md', filled = false, label, className, style }: IconProps) {
  const cls = [styles.icon, size === 'sm' ? styles.sm : '', filled ? styles.filled : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      className={cls}
      style={style}
      // A labelled icon is content and announces itself; an unlabelled one is decoration beside
      // text that already says the same thing, and announcing it would just repeat that text.
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {CODEPOINTS[name]}
    </span>
  );
}
