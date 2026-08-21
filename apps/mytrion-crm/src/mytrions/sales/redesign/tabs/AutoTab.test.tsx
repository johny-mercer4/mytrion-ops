import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { clearFocusMock, logAutomationMock, runAutomationMock } = vi.hoisted(() => ({
  clearFocusMock: vi.fn(),
  logAutomationMock: vi.fn(),
  runAutomationMock: vi.fn(),
}));

vi.mock('../ctx', () => ({
  useSales: () => ({
    focusAutomationId: 'efs-login',
    clearFocusAutomation: clearFocusMock,
  }),
}));

vi.mock('@/api/touchpoints', () => ({
  logAutomation: logAutomationMock,
  automationErrorCode: () => 'automation_failed',
}));

vi.mock('../autoRunners', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../autoRunners')>();
  return { ...actual, runAutomation: runAutomationMock };
});

vi.mock('../live', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../live')>();
  return {
    ...actual,
    useLoad: () => ({
      data: [],
      loading: false,
      error: null,
      reload: vi.fn(),
    }),
  };
});

vi.mock('../AutoWexEligibility', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../AutoWexEligibility')>();
  return {
    ...actual,
    useWexActionContext: () => ({
      required: false,
      loading: false,
      error: null,
      data: null,
    }),
  };
});

vi.mock('../AutoCardCredentials', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../AutoCardCredentials')>();
  return {
    ...actual,
    useCardCredentials: () => ({
      required: false,
      loading: false,
      error: null,
      data: null,
    }),
  };
});

import { AutoTab } from './AutoTab';

describe('AutoTab active-run guards', () => {
  beforeEach(() => {
    clearFocusMock.mockClear();
    logAutomationMock.mockReset();
    runAutomationMock.mockReset();
    vi.stubGlobal('open', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dispatches once and blocks Escape/X until the request settles', async () => {
    let finish!: (value: { kind: 'link'; label: string; url: string }) => void;
    runAutomationMock.mockReturnValue(new Promise((resolve) => {
      finish = resolve;
    }));

    render(<AutoTab />);
    const submit = await screen.findByRole('button', { name: 'Open Guide' });

    // Keep both native clicks in one React batch: state-driven button removal cannot be the thing
    // preventing the second dispatch; the synchronous ref latch must do it.
    act(() => {
      submit.click();
      submit.click();
    });
    expect(runAutomationMock).toHaveBeenCalledOnce();
    expect(logAutomationMock).toHaveBeenCalledWith(
      'efs-login',
      expect.objectContaining({ phase: 'started', runId: expect.any(String) }),
    );

    const guardedClose = screen.getByRole('button', {
      name: 'Close unavailable while action is running',
    });
    expect(guardedClose).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(guardedClose).toBeInTheDocument();

    await act(async () => {
      finish({
        kind: 'link',
        label: 'Open the EFS guide',
        url: 'https://example.test/efs-guide.pdf',
      });
    });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument());
    expect(logAutomationMock).toHaveBeenLastCalledWith(
      'efs-login',
      expect.objectContaining({
        phase: 'succeeded',
        runId: expect.any(String),
        durationMs: expect.any(Number),
      }),
    );
    expect(logAutomationMock.mock.calls[0]?.[1]?.runId).toBe(
      logAutomationMock.mock.calls[1]?.[1]?.runId,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
  });
});
