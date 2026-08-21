import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pullIsoftPull = vi.fn();
const createPlaidLinkToken = vi.fn();
const parseHighwayFile = vi.fn();
vi.mock('@/api/verificationIsoftpull', () => ({ pullIsoftPull }));
vi.mock('@/api/verificationPlaid', () => ({ createPlaidLinkToken }));
vi.mock('@/api/verificationHighway', () => ({ parseHighwayFile }));
vi.mock('@/api/verificationFmcsa', () => ({ searchFmcsa: vi.fn() }));
vi.mock('@/api/verificationMotus', () => ({ searchMotus: vi.fn() }));
vi.mock('@/api/verificationBrokerSnapshot', () => ({ searchBrokerSnapshot: vi.fn() }));
vi.mock('@/api/verificationBlacklist', () => ({ searchBlacklist: vi.fn() }));
vi.mock('@/api/verificationCiti', () => ({ searchCiti: vi.fn() }));

const { CaseDataCenter } = await import('./CaseDataCenter');

beforeEach(() => {
  pullIsoftPull.mockReset();
  createPlaidLinkToken.mockReset();
  parseHighwayFile.mockReset();
});

describe('CaseDataCenter paid vendor tabs', () => {
  it('hides iSoftPull, Plaid, and Highway and does not call their clients', () => {
    render(<CaseDataCenter caseRow={{ firstName: 'Ada', lastName: 'Cole' }} />);
    expect(screen.queryByRole('tab', { name: 'iSoftPull' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Plaid' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Highway' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pull report' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mint Link token' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Parse' })).not.toBeInTheDocument();
    expect(pullIsoftPull).not.toHaveBeenCalled();
    expect(createPlaidLinkToken).not.toHaveBeenCalled();
    expect(parseHighwayFile).not.toHaveBeenCalled();
  });
});
