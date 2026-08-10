/**
 * Avatar/ exports two symbols, so it carries a re-export (CONVENTIONS §1).
 *
 * AvatarGroup lives beside Avatar rather than in its own folder because it is not a peer component:
 * it types its children as `ReactElement<AvatarProps>`, clones them to force a uniform `size`, and
 * owns the accessible name that Avatar deliberately does not have. Split them and that contract
 * becomes a circular import between two folders.
 */

export { Avatar } from './Avatar';
export type { AvatarProps, AvatarSize, AvatarStatus } from './Avatar';

export { AvatarGroup } from './AvatarGroup';
export type { AvatarGroupProps } from './AvatarGroup';
