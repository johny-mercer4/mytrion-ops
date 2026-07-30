/**
 * Owner defaulting on create. The widget left Owner blank, so every new Citifuel client landed
 * unowned; a new record is now owned by whoever creates it.
 *
 * Covered here rather than in the browser because the local dev session is the UNTRUSTED mock
 * (userId 'dev-user'), which is deliberately not seeded — 'dev-user' is not a CRM user id, and
 * sending it as a lookup `{id}` would fail the Zoho write.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { CitiModal } from './CitiModal';
import type { UserContext } from '../../context/userContext';

// The roster lives inside the factory: vi.mock is hoisted above every top-level binding.
vi.mock('@/api/cs', () => ({
  createCitifuel: vi.fn(),
  deleteCitifuel: vi.fn(),
  lookupAccounts: vi.fn().mockResolvedValue({ accounts: [] }),
  lookupUsers: vi.fn().mockResolvedValue({
    users: [
      { id: '4582000000123456', name: 'Shohruh A', email: 'shohruh.a@octanefuel.com' },
      { id: '4582000000999999', name: 'Someone Else', email: 'else@octanefuel.com' },
    ],
  }),
  updateCitifuel: vi.fn(),
}));

let currentUser: UserContext;
vi.mock('@/context/UserContextProvider', () => ({
  useUserContext: () => currentUser,
}));

function renderCreate(user: UserContext) {
  currentUser = user;
  render(
    <div className="cs-root">
      <CitiModal client={null} onClose={vi.fn()} onSaved={vi.fn()} onDeleted={vi.fn()} notify={vi.fn()} />
    </div>,
  );
  // Two user lookups render (Agent, Owner); Owner is the second combobox of that pair.
  return () => screen.getAllByRole('combobox').at(-1) as HTMLSelectElement;
}

const verified: UserContext = {
  userId: '4582000000123456',
  profile: 'Customer Service',
  role: 'Support',
  userName: 'Shohruh A',
  trusted: true,
};

describe('CitiModal — Owner on create', () => {
  it('defaults Owner to the signed-in worker', async () => {
    const owner = renderCreate(verified);

    await waitFor(() => expect(owner().value).toBe('4582000000123456'));
    // The roster arrived, so the label comes from it rather than the out-of-roster fallback.
    expect(owner().selectedOptions[0]?.textContent).toBe('Shohruh A');
  });

  it('shows the worker by name before the roster arrives, so the field is never a bare id', async () => {
    const owner = renderCreate(verified);

    // Synchronous first paint — lookupUsers() has not resolved yet, so this is the session-seeded
    // out-of-roster option rather than a roster entry.
    expect(owner().value).toBe('4582000000123456');
    expect(owner().selectedOptions[0]?.textContent).toBe('Shohruh A');
    // Let the roster land inside act() so the pending state update isn't reported as a leak.
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(3));
  });

  it('leaves Owner blank for an untrusted (dev-mock) session — its id is not a CRM user', async () => {
    const owner = renderCreate({
      userId: 'dev-user',
      profile: 'Administrator',
      role: 'CEO',
      userName: 'Dev User',
      trusted: false,
    });

    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(2));
    expect(owner().value).toBe('');
  });
});
