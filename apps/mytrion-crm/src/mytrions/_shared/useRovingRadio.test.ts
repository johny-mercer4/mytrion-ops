/**
 * `role="radio"` on a button promises arrow-key navigation and a single tab stop. Before this hook
 * the verification and intake pickers declared the role and delivered neither, which is worse than
 * plain buttons: a screen reader announces an affordance that does not exist.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRovingRadio } from './useRovingRadio';

const VALUES = ['strong', 'moderate', 'weak'] as const;
type Tier = (typeof VALUES)[number];

function keyEvent(key: string) {
  return { key, preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLButtonElement>;
}

function setup(current: Tier | '', onSelect = vi.fn()) {
  const { result } = renderHook(() => useRovingRadio(VALUES, current, onSelect));
  return { props: result.current, onSelect };
}

describe('roving tab index', () => {
  it('makes only the checked option tabbable, so the group is one tab stop', () => {
    const { props } = setup('moderate');
    expect(props('strong').tabIndex).toBe(-1);
    expect(props('moderate').tabIndex).toBe(0);
    expect(props('weak').tabIndex).toBe(-1);
  });

  it('keeps the group reachable when nothing is selected yet', () => {
    // Every option at -1 would drop the group out of the tab order entirely.
    const { props } = setup('');
    expect(props('strong').tabIndex).toBe(0);
    expect(props('moderate').tabIndex).toBe(-1);
  });
});

describe('arrow keys move and select', () => {
  it('ArrowRight and ArrowDown move forward', () => {
    for (const key of ['ArrowRight', 'ArrowDown']) {
      const { props, onSelect } = setup('strong');
      props('strong').onKeyDown(keyEvent(key));
      expect(onSelect).toHaveBeenCalledWith('moderate');
    }
  });

  it('ArrowLeft and ArrowUp move backward', () => {
    for (const key of ['ArrowLeft', 'ArrowUp']) {
      const { props, onSelect } = setup('moderate');
      props('moderate').onKeyDown(keyEvent(key));
      expect(onSelect).toHaveBeenCalledWith('strong');
    }
  });

  it('wraps past the end, per the APG', () => {
    const { props, onSelect } = setup('weak');
    props('weak').onKeyDown(keyEvent('ArrowRight'));
    expect(onSelect).toHaveBeenCalledWith('strong');
  });

  it('wraps before the start', () => {
    const { props, onSelect } = setup('strong');
    props('strong').onKeyDown(keyEvent('ArrowLeft'));
    expect(onSelect).toHaveBeenCalledWith('weak');
  });

  it('Home selects the first and End the last', () => {
    const home = setup('weak');
    home.props('weak').onKeyDown(keyEvent('Home'));
    expect(home.onSelect).toHaveBeenCalledWith('strong');

    const end = setup('strong');
    end.props('strong').onKeyDown(keyEvent('End'));
    expect(end.onSelect).toHaveBeenCalledWith('weak');
  });

  it('prevents default so the page does not scroll under the group', () => {
    const { props } = setup('strong');
    const event = keyEvent('ArrowDown');
    props('strong').onKeyDown(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('ignores keys it does not own', () => {
    const { props, onSelect } = setup('strong');
    const event = keyEvent('a');
    props('strong').onKeyDown(event);
    expect(onSelect).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
