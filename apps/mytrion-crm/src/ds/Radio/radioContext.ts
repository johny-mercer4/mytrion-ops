import { createContext, type ChangeEvent } from 'react';

/**
 * INTERNAL to `src/ds/Radio/`. Not part of the public surface and deliberately not exported from
 * `src/ds/index.ts`.
 *
 * It exists so `RadioGroup` can own the four things that are properties of the GROUP and not of any
 * one option — the shared `name`, the selected `value`, the change handler, and the group-wide
 * disabled/size/validity — without forcing every caller to repeat them on every `Radio`. A `Radio`
 * rendered outside a group reads `null` here and falls back entirely to its own props, so it still
 * works standalone.
 *
 * This is a React context created and consumed inside the design system. It is NOT app context:
 * nothing here reaches for the user, the router or the API, so the purity contract holds.
 */
export interface RadioGroupContextValue {
  /** The shared `name`. Same name = one native radio group = native arrow-key roving, for free. */
  name: string;
  /** Present only when the group is CONTROLLED. `undefined` means "uncontrolled, use defaultValue". */
  value?: string | undefined;
  /** Present only when the group is UNCONTROLLED. */
  defaultValue?: string | undefined;
  onChange?: ((value: string, event: ChangeEvent<HTMLInputElement>) => void) | undefined;
  disabled?: boolean | undefined;
  required?: boolean | undefined;
  invalid?: boolean | undefined;
  size?: 'sm' | 'md' | undefined;
  /** The group's error/description node id, so each option inherits the same description. */
  describedBy?: string | undefined;
}

export const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);
