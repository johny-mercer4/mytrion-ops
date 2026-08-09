import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApprovalBar } from './ApprovalBar';

const base = {
  action: 'Update 3 deals',
  summary: 'Sets Stage to Closed Won on 3 deals in Zoho CRM. This writes to the live CRM.',
  onApprove: () => {},
  onReject: () => {},
};

describe('ApprovalBar', () => {
  it('names both controls with the action, so neither is a bare "Approve"', () => {
    render(<ApprovalBar {...base} />);
    expect(screen.getByRole('button', { name: 'Approve: Update 3 deals' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject: Update 3 deals' })).toBeInTheDocument();
  });

  it('steals no focus — the consequential control is never autofocused', () => {
    render(<ApprovalBar {...base} risk="high" />);
    expect(document.body).toHaveFocus();
  });

  it('puts the safe option first in tab order', async () => {
    render(<ApprovalBar {...base} />);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: /^Reject/ })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: /^Approve/ })).toHaveFocus();
  });

  it('describes Approve with the consequence', () => {
    render(<ApprovalBar {...base} />);
    const approve = screen.getByRole('button', { name: /^Approve/ });
    const described = approve.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    expect(document.getElementById(described as string)).toHaveTextContent(/live CRM/);
  });

  it('blocks BOTH sides while one is running', async () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(<ApprovalBar {...base} onApprove={onApprove} onReject={onReject} busy="approve" />);
    await userEvent.click(screen.getByRole('button', { name: /^Approve/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Reject/ }));
    expect(onApprove).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });

  it('stops being a control once decided', () => {
    render(<ApprovalBar {...base} outcome="approved" outcomeNote="by A. Rahimov" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  it('announces transitions only, in one polite region', () => {
    const { container, rerender } = render(<ApprovalBar {...base} />);
    const regions = container.querySelectorAll('[aria-live]');
    expect(regions).toHaveLength(1);
    expect(regions[0]).toHaveTextContent('Approval required: Update 3 deals');
    rerender(<ApprovalBar {...base} outcome="approved" />);
    expect(container.querySelectorAll('[aria-live]')[0]).toHaveTextContent(
      'Approved: Update 3 deals',
    );
  });

  it('can defer announcing to a host that owns the live region', () => {
    const { container } = render(<ApprovalBar {...base} announce={false} />);
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(0);
  });

  it('says the risk in words, not only in colour', () => {
    render(<ApprovalBar {...base} risk="high" />);
    expect(screen.getByText('High risk')).toBeInTheDocument();
  });

  it('fires the handlers when idle', async () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(<ApprovalBar {...base} onApprove={onApprove} onReject={onReject} />);
    await userEvent.click(screen.getByRole('button', { name: /^Reject/ }));
    expect(onReject).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: /^Approve/ }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });
});
