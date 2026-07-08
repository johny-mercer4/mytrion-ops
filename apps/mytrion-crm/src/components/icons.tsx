import type { CSSProperties } from 'react';
import AddIcon from '@atlaskit/icon/core/add';
import AiAgentIcon from '@atlaskit/icon/core/ai-agent';
import ArrowRightGlyph from '@atlaskit/icon/core/arrow-right';
import ChatWidgetIcon from '@atlaskit/icon/core/chat-widget';
import CheckMarkIcon from '@atlaskit/icon/core/check-mark';
import ClockIcon from '@atlaskit/icon/core/clock';
import CrossIcon from '@atlaskit/icon/core/cross';
import DatabaseIcon from '@atlaskit/icon/core/database';
import FileIcon from '@atlaskit/icon/core/file';
import HashtagIcon from '@atlaskit/icon/core/hashtag';
import HomeGlyph from '@atlaskit/icon/core/home';
import LinkExternalIcon from '@atlaskit/icon/core/link-external';
import OfficeBuildingIcon from '@atlaskit/icon/core/office-building';
import PanelRightIcon from '@atlaskit/icon/core/panel-right';
import PeopleGroupIcon from '@atlaskit/icon/core/people-group';
import PersonGlyph from '@atlaskit/icon/core/person';
import RefreshIcon from '@atlaskit/icon/core/refresh';
import SearchGlyph from '@atlaskit/icon/core/search';
import SendIcon from '@atlaskit/icon/core/send';
import ThemeIcon from '@atlaskit/icon/core/theme';
import VideoStopIcon from '@atlaskit/icon/core/video-stop';

/**
 * Icon set — real Jira/Atlassian Design System glyphs (`@atlaskit/icon`, the same package Jira
 * itself ships) for functional UI icons, aliased under the app's own names so every consumer
 * keeps working unchanged. `label=""` marks each as decorative (the surrounding button/element
 * already carries its own aria-label/visible text). Atlaskit only exposes two fixed icon sizes —
 * `small` (12px) and `medium` (16px), matching real Jira; numeric `size` picks the nearer tier.
 * `className`/`style` apply to a wrapper span (atlaskit's own Icon has no such prop).
 */
type IconProps = { size?: number; className?: string; style?: CSSProperties };
type Glyph = (props: { label: string; size?: 'small' | 'medium' }) => JSX.Element;

function tier(size: number): 'small' | 'medium' {
  return size <= 13 ? 'small' : 'medium';
}

function wrap(Glyph: Glyph, size: number, className?: string, style?: CSSProperties) {
  return (
    <span className={className} style={style}>
      <Glyph label="" size={tier(size)} />
    </span>
  );
}

export const HomeIcon = ({ size = 19, className, style }: IconProps) => wrap(HomeGlyph, size, className, style);

/** Train tab (AI model training). */
export const TrainIcon = ({ size = 19, className, style }: IconProps) => wrap(AiAgentIcon, size, className, style);

export const KnowledgeIcon = ({ size = 19, className, style }: IconProps) => wrap(DatabaseIcon, size, className, style);

export const ScopeIcon = ({ size = 19, className, style }: IconProps) => wrap(HashtagIcon, size, className, style);

export const SearchIcon = ({ size = 15, className, style }: IconProps) => wrap(SearchGlyph, size, className, style);

export const SwitchIcon = ({ size = 13, className, style }: IconProps) => wrap(RefreshIcon, size, className, style);

export const PlusIcon = ({ size = 12, className, style }: IconProps) => wrap(AddIcon, size, className, style);

export const ArrowRightIcon = ({ size = 12, className, style }: IconProps) => wrap(ArrowRightGlyph, size, className, style);

export const SendArrowIcon = ({ size = 16, className, style }: IconProps) => wrap(SendIcon, size, className, style);

export const CheckIcon = ({ size = 11, className, style }: IconProps) => wrap(CheckMarkIcon, size, className, style);

export const XIcon = ({ size = 10, className, style }: IconProps) => wrap(CrossIcon, size, className, style);

export const DocIcon = ({ size = 14, className, style }: IconProps) => wrap(FileIcon, size, className, style);

/** Theme toggle — real ADS has one "theme" glyph, not separate sun/moon. */
export const MoonIcon = ({ size = 15, className, style }: IconProps) => wrap(ThemeIcon, size, className, style);
export const SunIcon = ({ size = 15, className, style }: IconProps) => wrap(ThemeIcon, size, className, style);

/** Collapse/expand a docked panel. */
export const PanelToggleIcon = ({ size = 14, className, style }: IconProps) => wrap(PanelRightIcon, size, className, style);

export const ExternalLinkIcon = ({ size = 13, className, style }: IconProps) => wrap(LinkExternalIcon, size, className, style);

export const ChatIcon = ({ size = 16, className, style }: IconProps) => wrap(ChatWidgetIcon, size, className, style);

/** Stop generation. */
export const StopIcon = ({ size = 12, className, style }: IconProps) => wrap(VideoStopIcon, size, className, style);

export const HistoryIcon = ({ size = 13, className, style }: IconProps) => wrap(ClockIcon, size, className, style);

export const UsersIcon = ({ size = 19, className, style }: IconProps) => wrap(PeopleGroupIcon, size, className, style);

/** Fleet owner (a company/account, not one person). */
export const BuildingIcon = ({ size = 14, className, style }: IconProps) => wrap(OfficeBuildingIcon, size, className, style);

/** One driver. */
export const PersonIcon = ({ size = 14, className, style }: IconProps) => wrap(PersonGlyph, size, className, style);

function stroke(size: number, path: string, sw = 2, className?: string, style?: CSSProperties) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

/**
 * The four-point fuel "spark" used in the brand mark and assistant gem (filled) — MYTRION's own
 * mark, not a Jira icon, so this stays hand-drawn rather than sourced from Atlaskit.
 */
export const Sparkle = ({ size = 16, className, style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
    <path d="M12 1.6c.55 5.18 4.62 9.25 9.8 9.8-5.18.55-9.25 4.62-9.8 9.8-.55-5.18-4.62-9.25-9.8-9.8 5.18-.55 9.25-4.62 9.8-9.8z" />
  </svg>
);

/** Per-Mytrion glyphs (shield/chart/receipt/etc.) keyed for the picker + nav — MYTRION's own, not Jira's. */
export const MytrionGlyph = ({ name, size = 22, className, style }: IconProps & { name: string }) => {
  const paths: Record<string, string> = {
    admin: 'M12 3l8 4v5c0 4.5-3.4 7.8-8 9-4.6-1.2-8-4.5-8-9V7l8-4z',
    sales: 'M3 17l6-6 4 4 8-8m0 0h-5m5 0v5',
    billing: 'M9 14l6-6m-6 0h.01M15 14h.01M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16l-3-2-2 2-2-2-2 2-2-2-3 2z',
    collection:
      'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 1v8m0 0v1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    finance: 'M3 21h12M3 21V5a2 2 0 012-2h6a2 2 0 012 2v16M13 8h3l3 3v8a2 2 0 01-2 2M16 11h3M7 7h2M7 11h2',
    'customer-service': 'M18 10a6 6 0 00-12 0c0 4-1.5 5-2 6h16c-.5-1-2-2-2-6zM10 20a2 2 0 004 0',
    retention: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z',
    verification: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
    manager: 'M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a3 3 0 10-2.5-1.34M5 11a3 3 0 102.5-1.34',
  };
  return stroke(size, paths[name] ?? paths.admin!, 1.8, className, style);
};
