import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatMinorUnits,
  OwnerOverviewDashboard,
  type OwnerAnalyticsOverview,
  validateCustomRange,
} from './OwnerOverviewDashboard';

const baseOverview: OwnerAnalyticsOverview = {
  metadata: {
    definitionVersion: 'owner-analytics-v1',
    endExclusive: '2026-10-01T00:00:00.000Z',
    environment: 'local',
    generatedAt: '2026-09-09T04:30:00.000Z',
    period: 'THIS_MONTH',
    startInclusive: '2026-09-01T00:00:00.000Z',
    syntheticData: true,
    timezone: 'Asia/Manila',
  },
  metrics: {
    activeRentalsNow: {
      classification: 'pointInTime',
      generatedAt: '2026-09-09T04:30:00.000Z',
      value: 2,
    },
    bookingsCreated: {
      absoluteChange: 3,
      classification: 'period',
      comparisonAvailable: true,
      current: 8,
      percentageChange: '60.00',
      previous: 5,
    },
    capturedRentalGbv: {
      classification: 'period',
      values: [
        {
          absoluteChangeMinor: '234567',
          comparisonAvailable: true,
          currency: 'PHP',
          currentMinor: '1234567',
          percentageChange: '23.45',
          previousMinor: '1000000',
        },
      ],
    },
    completedRefunds: {
      classification: 'period',
      values: [
        {
          absoluteChangeMinor: '-10000',
          comparisonAvailable: true,
          currency: 'PHP',
          currentMinor: '5000',
          percentageChange: '-66.66',
          previousMinor: '15000',
        },
      ],
    },
    completedRentals: {
      absoluteChange: -1,
      classification: 'period',
      comparisonAvailable: true,
      current: 4,
      percentageChange: '-20.00',
      previous: 5,
    },
    confirmedBookings: {
      absoluteChange: 0,
      classification: 'period',
      comparisonAvailable: false,
      current: 1,
      percentageChange: null,
      previous: 0,
    },
    recognizedCarShareCommission: {
      classification: 'period',
      values: [
        {
          absoluteChangeMinor: '2500',
          comparisonAvailable: true,
          currency: 'PHP',
          currentMinor: '12500',
          percentageChange: '25.00',
          previousMinor: '10000',
        },
      ],
    },
  },
};

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderDashboard(requestOverview = vi.fn().mockResolvedValue(baseOverview)) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <OwnerOverviewDashboard requestOverview={requestOverview} />
    </QueryClientProvider>,
  );
  return requestOverview;
}

describe('OwnerOverviewDashboard', () => {
  it('loads authoritative THIS_MONTH metrics by default and renders financial/activity KPIs', async () => {
    const request = renderDashboard();
    await screen.findByText('₱12,345.67');
    expect(request).toHaveBeenCalledWith('/admin/owner/analytics/overview?period=THIS_MONTH');
    expect(screen.getByText('CarShare Commission')).not.toBeNull();
    expect(screen.getByText('Gross Booking Value')).not.toBeNull();
    expect(screen.getByText('Completed Refunds')).not.toBeNull();
    expect(screen.getByText('LIVE • NOW')).not.toBeNull();
    expect(screen.getByText('↑ 23.45% vs previous period')).not.toBeNull();
    expect(screen.getByText('↓ 66.66% vs previous period')).not.toBeNull();
    expect(screen.getByText('Previous: ₱10,000.00')).not.toBeNull();
    expect(screen.getAllByText('Previous: 5')).toHaveLength(2);
    expect(screen.getByText('No comparable prior activity')).not.toBeNull();
    expect(screen.queryByText('Business value')).toBeNull();
  });

  it.each([
    ['Today', 'TODAY'],
    ['This Week', 'THIS_WEEK'],
    ['This Month', 'THIS_MONTH'],
  ])('requests the server-owned %s period', async (label, period) => {
    const request = renderDashboard();
    await screen.findByText('FINANCIAL PERFORMANCE');
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(`/admin/owner/analytics/overview?period=${period}`),
    );
  });

  it('applies a valid custom period and Cancel preserves the applied period', async () => {
    const request = renderDashboard();
    await screen.findByText('FINANCIAL PERFORMANCE');
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-09-09' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/admin/owner/analytics/overview?period=CUSTOM&startDate=2026-09-01&endDate=2026-09-09',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-09-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(request).not.toHaveBeenCalledWith(expect.stringContaining('endDate=2026-09-10'));
  });

  it('restores an applied period while navigating in the same browser session', async () => {
    window.sessionStorage.setItem(
      'carshare-owner-overview-period',
      JSON.stringify({ period: 'TODAY' }),
    );
    const request = renderDashboard();
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('/admin/owner/analytics/overview?period=TODAY'),
    );
    expect(screen.getByRole('button', { name: 'Today' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('rejects reversed and over-366-day custom ranges without requesting them', async () => {
    const request = renderDashboard();
    await screen.findByText('FINANCIAL PERFORMANCE');
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-09' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('alert').textContent).toContain('End date');
    expect(validateCustomRange('2025-01-01', '2026-01-02')).toContain('366');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('renders intentional zero states and never compares Active Rentals Now', async () => {
    const zero: OwnerAnalyticsOverview = {
      ...baseOverview,
      metrics: {
        ...baseOverview.metrics,
        activeRentalsNow: { ...baseOverview.metrics.activeRentalsNow, value: 0 },
        bookingsCreated: { ...baseOverview.metrics.bookingsCreated, current: 0 },
        capturedRentalGbv: { ...baseOverview.metrics.capturedRentalGbv, values: [] },
      },
    };
    renderDashboard(vi.fn().mockResolvedValue(zero));
    expect(await screen.findByText('₱0.00')).not.toBeNull();
    expect(screen.getByText('No captured rental activity in this period.')).not.toBeNull();
    expect(screen.getByText('No bookings were created in this period.')).not.toBeNull();
    expect(screen.getByText('No rentals are active right now.')).not.toBeNull();
    expect(screen.getByText('Active Rentals Now').closest('article')?.textContent).not.toContain(
      'previous period',
    );
  });

  it('shows the synthetic warning only when the API marks data synthetic', async () => {
    renderDashboard();
    expect(await screen.findByText('LOCAL • SYNTHETIC DATA')).not.toBeNull();
    cleanup();
    const production: OwnerAnalyticsOverview = {
      ...baseOverview,
      metadata: { ...baseOverview.metadata, environment: 'production', syntheticData: false },
    };
    renderDashboard(vi.fn().mockResolvedValue(production));
    await screen.findByText('FINANCIAL PERFORMANCE');
    expect(screen.queryByText(/SYNTHETIC DATA/u)).toBeNull();
  });

  it('keeps multiple currencies visibly separated', async () => {
    const multiple: OwnerAnalyticsOverview = {
      ...baseOverview,
      metrics: {
        ...baseOverview.metrics,
        capturedRentalGbv: {
          ...baseOverview.metrics.capturedRentalGbv,
          values: [
            ...baseOverview.metrics.capturedRentalGbv.values,
            {
              absoluteChangeMinor: '0',
              comparisonAvailable: false,
              currency: 'USD',
              currentMinor: '4200',
              percentageChange: null,
              previousMinor: '0',
            },
          ],
        },
      },
    };
    renderDashboard(vi.fn().mockResolvedValue(multiple));
    expect(await screen.findByText('₱12,345.67')).not.toBeNull();
    expect(screen.getByText('USD 42.00')).not.toBeNull();
    expect(screen.getAllByText('PHP').length).toBeGreaterThan(0);
    expect(screen.getAllByText('USD').length).toBeGreaterThan(0);
  });

  it('describes an unchanged comparable metric without a zero-percent indicator', async () => {
    const unchanged: OwnerAnalyticsOverview = {
      ...baseOverview,
      metrics: {
        ...baseOverview.metrics,
        completedRentals: {
          ...baseOverview.metrics.completedRentals,
          absoluteChange: 0,
          current: 4,
          percentageChange: '0.00',
          previous: 4,
        },
      },
    };
    renderDashboard(vi.fn().mockResolvedValue(unchanged));
    expect(await screen.findByText('No change vs previous period')).not.toBeNull();
    expect(screen.queryByText('— 0.00% vs previous period')).toBeNull();
    expect(screen.getByText('Previous: 4')).not.toBeNull();
  });

  it('renders an accessible loading state and a safe retry state', async () => {
    renderDashboard(vi.fn(() => new Promise(() => undefined)));
    expect(screen.getByText('Loading business performance overview')).not.toBeNull();
    cleanup();
    const request = vi.fn().mockRejectedValue(new Error('private raw provider error'));
    renderDashboard(request);
    expect((await screen.findByRole('alert')).textContent).not.toContain(
      'private raw provider error',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });
});

describe('Owner overview presentation helpers', () => {
  it('formats integer minor units without floating-point arithmetic', () => {
    expect(formatMinorUnits('123456789012345678', 'PHP')).toBe('₱1,234,567,890,123,456.78');
    expect(formatMinorUnits('-42', 'USD')).toBe('-USD 0.42');
  });
});
