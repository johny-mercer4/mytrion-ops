import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { sendVerificationResponse, type PipelineRequirement } from '@/api/verification';
import { VerificationActionRequest } from './VerificationActionRequest';

vi.mock('@/api/verification', async () => {
  const actual = await vi.importActual<typeof import('@/api/verification')>('@/api/verification');
  return { ...actual, sendVerificationResponse: vi.fn() };
});

const requirement: PipelineRequirement = {
  id: 'verification-41',
  eventId: '41',
  title: 'MC DOT needed from Sales',
  detail: 'Confirm both identifiers.',
  createdAt: '2026-08-01T10:00:00.000Z',
  fields: [
    { id: 'mc_number', label: 'MC number', type: 'text', required: true },
    { id: 'dot_number', label: 'DOT number', type: 'text', required: true },
  ],
  attachmentRequired: false,
  attachmentLabel: null,
};

describe('VerificationActionRequest', () => {
  it('validates and sends payload-defined field values', async () => {
    vi.mocked(sendVerificationResponse).mockResolvedValue({
      response: { sentAt: new Date().toISOString(), sentBy: 'agent-1', attachmentName: null, warning: null },
      duplicate: false,
    });
    const onSent = vi.fn();
    render(
      <VerificationActionRequest
        requestId="deal-1"
        dealId="6227679000000000001"
        requirement={requirement}
        onSent={onSent}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Enter mc number'), { target: { value: '123456' } });
    fireEvent.change(screen.getByPlaceholderText('Enter dot number'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Verification' }));

    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(sendVerificationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'deal-1',
        dealId: '6227679000000000001',
        externalEventId: '41',
        values: { mc_number: '123456', dot_number: '654321' },
      }),
    );
  });
});
