import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OwnerRevenueDashboard, type OwnerRevenueSummary } from './OwnerRevenueDashboard';

const money = (amountMinor: string, currency = 'PHP') => [{ amountMinor, currency }];
const counted = (amountMinor: string, count: number, currency = 'PHP') => ({
  classification: 'PERIOD' as const,
  values: [{ amountMinor, count, currency }],
});

const summary: OwnerRevenueSummary = {
  metadata: {
    classification: 'GROUPED_BY_CURRENCY',
    definitionVersion: 'owner-revenue-v1',
    endExclusive: '2026-10-01T00:00:00.000Z',
    environment: 'local',
    generatedAt: '2026-09-09T04:30:00.000Z',
    period: 'THIS_MONTH',
    startInclusive: '2026-09-01T00:00:00.000Z',
    syntheticData: true,
    timezone: 'Asia/Manila',
  },
  periodActivity: {
    capturedCollections: {
      additionalCharge: [],
      classification: 'PERIOD',
      rental: money('1340000'),
      securityDeposit: [],
    },
    rentalGbv: { classification: 'PERIOD', values: money('1340000') },
    recognizedCarShareCommission: { classification: 'PERIOD', values: money('201000') },
    ownerEarnings: {
      byStatus: {
        PENDING: money('300000'),
        HELD: money('200000'),
        AVAILABLE: money('39000'),
        PAID: money('600000'),
        REVERSED: [],
      },
      classification: 'PERIOD',
      total: { classification: 'PERIOD', values: money('1139000') },
    },
    completedRefunds: { classification: 'PERIOD', values: money('5000') },
    additionalCharges: {
      classification: 'PERIOD',
      approved: { classification: 'PERIOD', values: [] },
      collected: { classification: 'PERIOD', values: [] },
      refunded: { classification: 'PERIOD', values: [] },
      ownerCompensation: { classification: 'PERIOD', values: [] },
      platformShare: { classification: 'PERIOD', values: [] },
    },
    payouts: {
      classification: 'PERIOD',
      created: counted('100000', 2),
      approved: counted('50000', 1),
      submitted: counted('0', 0),
      paid: counted('0', 0),
      failed: counted('0', 0),
      reversed: counted('0', 0),
    },
  },
  pointInTime: {
    ownerPayableLiability: { classification: 'POINT_IN_TIME', values: money('1317500') },
    availableForPayout: { classification: 'POINT_IN_TIME', values: [] },
    earnings: {
      byStatus: { PENDING: [], HELD: [], AVAILABLE: [], PAID: [], REVERSED: [] },
      classification: 'POINT_IN_TIME',
    },
    activePayoutAllocations: { ...counted('50000', 1), classification: 'POINT_IN_TIME' },
    processingPayouts: { ...counted('0', 0), classification: 'POINT_IN_TIME' },
  },
  integrity: {
    authoritativeTotalsComplete: false,
    excludedReconciliationRequiredCount: 1,
    financialIntegrityWarning: true,
  },
  unavailable: ['trueNetPlatformRevenue', 'profit'],
};

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderDashboard(requestRevenue = vi.fn().mockResolvedValue(summary)) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <OwnerRevenueDashboard requestRevenue={requestRevenue} />
    </QueryClientProvider>,
  );
  return requestRevenue;
}

describe('OwnerRevenueDashboard', () => {
  it('loads owner-revenue-v1 for This Month and keeps financial concepts separated', async () => {
    const request = renderDashboard();
    expect(await screen.findAllByText('₱13,400.00')).toHaveLength(2);
    expect(request).toHaveBeenCalledWith('/admin/owner/revenue?period=THIS_MONTH');
    expect(screen.getByText('MONEY COLLECTED')).not.toBeNull();
    expect(screen.getByText('CARSHARE EARNINGS')).not.toBeNull();
    expect(screen.getByText('VEHICLE OWNER MONEY')).not.toBeNull();
    expect(screen.getByText('PAYOUT ACTIVITY')).not.toBeNull();
    expect(screen.getByText('Recognized CarShare Commission')).not.toBeNull();
    expect(screen.queryByText('Net Profit')).toBeNull();
  });

  it('keeps Total Owner Earnings prominent and renders every status in one compact breakdown', async () => {
    renderDashboard();
    const total = (await screen.findByText('Total Owner Earnings')).closest('article')!;
    expect(total.className).toContain('owner-total-card');
    const breakdown = screen.getByRole('region', { name: 'Earnings breakdown' });
    for (const label of ['Pending', 'Held', 'Available', 'Paid', 'Reversed'])
      expect(within(breakdown).getByText(label)).not.toBeNull();
    expect(screen.queryByText('Unavailable')).toBeNull();
  });

  it('clarifies collections and GBV visibly while treating additional metrics as secondary', async () => {
    renderDashboard();
    expect(await screen.findByText('Captured renter payments.')).not.toBeNull();
    expect(
      screen.getByText('Contracted rental value; may differ from collections.'),
    ).not.toBeNull();
    expect(
      screen.getByText('Additional Charge Collections').closest('article')?.className,
    ).toContain('secondary-financial-card');
    expect(
      screen.getByText('Additional Charge CarShare Share').closest('article')?.className,
    ).toContain('secondary-financial-card');
  });

  it('makes point-in-time liability and eligibility distinct and does not compare them', async () => {
    renderDashboard();
    const payable = (await screen.findByText('Owner Payable Liability')).closest('article')!;
    const eligible = screen.getByText('Available for Payout').closest('article')!;
    expect(within(payable).getByText('₱13,175.00')).not.toBeNull();
    expect(within(payable).getByText('CURRENT BALANCE')).not.toBeNull();
    expect(within(eligible).getByText('₱0.00')).not.toBeNull();
    expect(within(eligible).getByText('CURRENTLY ELIGIBLE')).not.toBeNull();
    expect(payable.textContent).not.toContain('previous period');
    expect(eligible.textContent).not.toContain('previous period');
  });

  it('shows payout amounts and counts with intentional zero states', async () => {
    renderDashboard();
    const pending = (await screen.findByText('Pending Approval')).closest('tr')!;
    expect(within(pending).getByText('₱1,000.00')).not.toBeNull();
    expect(within(pending).getByText('2 payouts')).not.toBeNull();
    const payoutTable = screen.getByRole('table', {
      name: 'Selected-period payout lifecycle amounts and counts',
    });
    const paid = within(payoutTable).getByText('Paid').closest('tr')!;
    expect(within(paid).getByText('₱0.00')).not.toBeNull();
    expect(within(paid).getByText('0 payouts')).not.toBeNull();
    expect(screen.getByText('No payouts are currently processing.')).not.toBeNull();
  });

  it('shows clean additional-charge zero states without inventing deposit collections', async () => {
    renderDashboard();
    expect(await screen.findByText('ADDITIONAL CHARGES')).not.toBeNull();
    const breakdown = screen.getByRole('region', { name: 'Additional-charge breakdown' });
    for (const label of [
      'Approved',
      'Collected',
      'Refunded',
      'Owner Compensation',
      'CarShare Share',
    ])
      expect(within(breakdown).getByText(label)).not.toBeNull();
    expect(within(breakdown).getAllByText('₱0.00')).toHaveLength(5);
    expect(screen.queryByText(/Security Deposit/u)).toBeNull();
  });

  it('shows synthetic and safe reconciliation warnings without private identifiers', async () => {
    renderDashboard();
    expect(await screen.findByText('LOCAL • SYNTHETIC DATA')).not.toBeNull();
    expect(screen.getByText('Financial reconciliation in progress')).not.toBeNull();
    expect(document.body.textContent).not.toContain('payment-id');
    expect(document.body.textContent).not.toContain('providerReference');
  });

  it.each([
    ['Today', 'TODAY'],
    ['This Week', 'THIS_WEEK'],
    ['This Month', 'THIS_MONTH'],
  ])('requests the authoritative %s period', async (label, period) => {
    const request = renderDashboard();
    await screen.findByText('MONEY COLLECTED');
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(`/admin/owner/revenue?period=${period}`),
    );
  });

  it('applies and persists a valid custom range while rejecting invalid ranges', async () => {
    const request = renderDashboard();
    await screen.findByText('MONEY COLLECTED');
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-09-09' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/admin/owner/revenue?period=CUSTOM&startDate=2026-09-01&endDate=2026-09-09',
      ),
    );
    expect(window.sessionStorage.getItem('carshare-owner-revenue-period')).toContain('CUSTOM');
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-08-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('alert').textContent).toContain('End date');
  });

  it('keeps currencies separate and formats very large minor-unit strings without Number', async () => {
    const multiple: OwnerRevenueSummary = {
      ...summary,
      periodActivity: {
        ...summary.periodActivity,
        capturedCollections: {
          ...summary.periodActivity.capturedCollections,
          rental: [...money('900719925474099300'), ...money('4200', 'USD')],
        },
      },
    };
    renderDashboard(vi.fn().mockResolvedValue(multiple));
    expect(await screen.findByText('₱9,007,199,254,740,993.00')).not.toBeNull();
    expect(screen.getByText('USD 42.00')).not.toBeNull();
    expect(screen.getAllByText('PHP').length).toBeGreaterThan(0);
    expect(screen.getAllByText('USD').length).toBeGreaterThan(0);
  });

  it('uses skeleton loading and a retryable provider-neutral error', async () => {
    const pending = new Promise<OwnerRevenueSummary>(() => undefined);
    renderDashboard(vi.fn().mockReturnValue(pending));
    expect(screen.getByText('Loading authoritative revenue and earnings')).not.toBeNull();
    cleanup();
    const failed = vi.fn().mockRejectedValue(new Error('raw private provider error'));
    renderDashboard(failed);
    expect(
      await screen.findByText('Revenue and earnings are temporarily unavailable.'),
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain('raw private provider error');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(failed).toHaveBeenCalledTimes(2));
  });

  it('reserves authoritative trends without rendering a chart or client calculations', async () => {
    renderDashboard();
    expect(await screen.findByText('Revenue and earnings trends')).not.toBeNull();
    expect(document.querySelector('canvas')).toBeNull();
    expect(document.querySelector('svg')).toBeNull();
  });
});
