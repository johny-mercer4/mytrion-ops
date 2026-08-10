/**
 * `Radio/` exports two public symbols, so per CONVENTIONS §1 it carries a folder barrel.
 *
 * `radioContext.ts` is INTERNAL and is not re-exported: the context is the wire between the group
 * and its options, not an API. A caller who needs to read the selection reads their own state.
 */
export { Radio } from './Radio';
export type { RadioProps, RadioSize } from './Radio';

export { RadioGroup } from './RadioGroup';
export type { RadioGroupProps, RadioGroupOrientation } from './RadioGroup';
