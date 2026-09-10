import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatMarketplaceCount,
  OwnerMarketplaceReportsDashboard,
  type OwnerMarketplaceReport,
  type OwnerMarketplaceTrends,
} from './OwnerMarketplaceReportsDashboard';

const integrity = {
  actualPickupsWithoutActiveTransition: 0,
  cancellationRecordsWithoutTransition: 0,
  cancellationTransitionsWithoutRecord: 0,
  rentalsStartedChecked: 3,
  rentalsStartedMissingActualPickup: 0,
  rentalsStartedPickupTimestampMismatch: 0,
  status: 'PASS' as const,
};

const report: OwnerMarketplaceReport = {
  definitionVersion: 'owner-marketplace-reports-v1',
  environment: 'local',
  syntheticData: true,
  timezone: 'Asia/Manila',
  generatedAt: '2026-09-09T04:30:00.000Z',
  period: {
    kind: 'THIS_MONTH',
    startInclusive: '2026-08-31T16:00:00.000Z',
    endExclusive: '2026-09-30T16:00:00.000Z',
  },
  periodActivity: {
    bookingsCreated: 4,
    confirmedBookings: 3,
    rentalsStarted: 3,
    completedRentals: 2,
    cancellations: 0,
    newRenters: 10,
    newVehicleOwners: 6,
    newVehicles: 2,
    activeRentersDuringPeriod: 1,
  },
  cohortMetrics: {
    bookingConfirmationConversion: {
      classification: 'cohortToDate',
      cohortSize: 4,
      count: 3,
      definition:
        'Bookings created in the selected period that reached their first CONFIRMED transition by generatedAt.',
      maturityCutoffApplied: false,
      rate: '75.00',
      rateUnit: 'PERCENT',
    },
    bookingCohortCancellationRate: {
      classification: 'cohortToDate',
      cohortSize: 4,
      count: 0,
      definition:
        'Bookings created in the selected period that received a cancellation record by generatedAt.',
      maturityCutoffApplied: false,
      rate: '0.00',
      rateUnit: 'PERCENT',
    },
  },
  pointInTime: {
    activeRentalsNow: { asOf: '2026-09-09T04:30:00.000Z', value: 3 },
    approvedListingsNow: { asOf: '2026-09-09T04:30:00.000Z', value: 10 },
  },
  cancellationBreakdown: { actorAndReasonCode: [] },
  integrity,
};

const points = [
  {
    startInclusive: '2026-08-31T16:00:00.000Z',
    endExclusive: '2026-09-01T16:00:00.000Z',
    count: '1',
  },
  {
    startInclusive: '2026-09-01T16:00:00.000Z',
    endExclusive: '2026-09-02T16:00:00.000Z',
    count: '0',
  },
];

const trends: OwnerMarketplaceTrends = {
  definitionVersion: 'owner-marketplace-trends-v1',
  environment: 'local',
  syntheticData: true,
  timezone: 'Asia/Manila',
  generatedAt: '2026-09-09T04:30:00.000Z',
  period: report.period,
  granularity: 'DAILY',
  series: {
    bookingsCreated: points,
    confirmedBookings: points,
    rentalsStarted: points,
    completedRentals: points,
    cancellations: points,
    newRenters: points,
    newVehicleOwners: points,
    newVehicles: points,
  },
  integrity,
};

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderDashboard(
  requestReport = vi.fn().mockResolvedValue(report),
  requestTrends = vi.fn().mockResolvedValue(trends),
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <OwnerMarketplaceReportsDashboard
        requestReport={requestReport}
        requestTrends={requestTrends}
      />
    </QueryClientProvider>,
  );
  return { requestReport, requestTrends };
}

describe('OwnerMarketplaceReportsDashboard', () => {
  it('loads both authoritative contracts for the default This Month period', async () => {
    const { requestReport, requestTrends } = renderDashboard();
    expect(await screen.findByText('BOOKING & RENTAL ACTIVITY')).not.toBeNull();
    expect(requestReport).toHaveBeenCalledWith(
      '/admin/owner/reports/marketplace?period=THIS_MONTH',
    );
    expect(requestTrends).toHaveBeenCalledWith(
      '/admin/owner/reports/marketplace/trends?period=THIS_MONTH',
    );
    expect(screen.getByText('LOCAL • SYNTHETIC DATA')).not.toBeNull();
  });

  it.each([
    ['Today', 'TODAY'],
    ['This Week', 'THIS_WEEK'],
    ['This Month', 'THIS_MONTH'],
  ])('requests the authoritative %s period', async (label, period) => {
    const { requestReport } = renderDashboard();
    await screen.findByText('BOOKING & RENTAL ACTIVITY');
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() =>
      expect(requestReport).toHaveBeenCalledWith(
        `/admin/owner/reports/marketplace?period=${period}`,
      ),
    );
  });

  it('validates, applies, and persists a Reports-specific custom range', async () => {
    const { requestReport } = renderDashboard();
    await screen.findByText('BOOKING & RENTAL ACTIVITY');
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-09-09' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(requestReport).toHaveBeenCalledWith(
        '/admin/owner/reports/marketplace?period=CUSTOM&startDate=2026-09-01&endDate=2026-09-09',
      ),
    );
    expect(window.sessionStorage.getItem('carshare-owner-marketplace-reports-period')).toContain(
      'CUSTOM',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-08-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('alert').textContent).toContain('End date');
  });

  it('uses clear hierarchy for authoritative booking and rental activity', async () => {
    renderDashboard();
    const activity = await screen.findByRole('region', {
      name: 'Marketplace lifecycle activity',
    });
    const created = within(activity).getByText('Bookings Created').closest('article')!;
    expect(created.className).toContain('prominent');
    expect(within(created).getByText('4')).not.toBeNull();
    expect(within(activity).getByText('Confirmed Bookings')).not.toBeNull();
    expect(within(activity).getByText('Rentals Started')).not.toBeNull();
    expect(within(activity).getByText('Completed Rentals')).not.toBeNull();
    expect(within(activity).getByText('Cancellations')).not.toBeNull();
  });

  it('presents growth with the exact Active Renters During Period definition', async () => {
    renderDashboard();
    expect(await screen.findByText('CUSTOMER & SUPPLY GROWTH')).not.toBeNull();
    const growth = screen.getByRole('region', { name: 'Marketplace participation' });
    expect(within(growth).getByText('New Renters')).not.toBeNull();
    expect(within(growth).getByText('New Vehicle Owners')).not.toBeNull();
    expect(within(growth).getByText('New Vehicles')).not.toBeNull();
    expect(within(growth).getByText('Active Renters During Period')).not.toBeNull();
    expect(within(growth).queryByText(/^Active Renters$/u)).toBeNull();
  });

  it('labels both cohort-to-date measures and explains maturity without comparison', async () => {
    renderDashboard();
    expect(await screen.findByText('75.00%')).not.toBeNull();
    expect(screen.getByText('3 of 4 bookings')).not.toBeNull();
    expect(screen.getByText('0.00%')).not.toBeNull();
    expect(screen.getByText('0 of 4 bookings')).not.toBeNull();
    expect(screen.getAllByText('COHORT TO DATE')).toHaveLength(2);
    expect(
      screen.getByText('Recent cohorts may have had less time to confirm or cancel.'),
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain('previous period');
  });

  it('uses an intentional unavailable state for an empty cohort', async () => {
    const empty: OwnerMarketplaceReport = {
      ...report,
      cohortMetrics: {
        bookingConfirmationConversion: {
          ...report.cohortMetrics.bookingConfirmationConversion,
          cohortSize: 0,
          count: 0,
          rate: null,
        },
        bookingCohortCancellationRate: {
          ...report.cohortMetrics.bookingCohortCancellationRate,
          cohortSize: 0,
          count: 0,
          rate: null,
        },
      },
    };
    renderDashboard(vi.fn().mockResolvedValue(empty));
    expect(await screen.findAllByText('No booking cohort in this period')).toHaveLength(2);
  });

  it('keeps current marketplace values visually and semantically separate', async () => {
    renderDashboard();
    const active = (await screen.findByText('Active Rentals Now')).closest('article')!;
    const listings = screen.getByText('Approved Listings Now').closest('article')!;
    expect(within(active).getByText('LIVE • NOW')).not.toBeNull();
    expect(within(listings).getByText('CURRENT')).not.toBeNull();
    expect(within(active).getByText(/^As of/u)).not.toBeNull();
    expect(active.textContent).not.toContain('This Month');
    expect(listings.textContent).not.toContain('previous');
  });

  it('shows an intentional cancellation zero state and aggregate rows when present', async () => {
    renderDashboard();
    expect(
      await screen.findByText('No cancellation events were recorded in this period.'),
    ).not.toBeNull();
    cleanup();
    const withCancellation: OwnerMarketplaceReport = {
      ...report,
      cancellationBreakdown: {
        actorAndReasonCode: [{ actorType: 'USER', reasonCode: 'RENTER_CANCELLED', count: 1 }],
      },
    };
    renderDashboard(vi.fn().mockResolvedValue(withCancellation));
    const table = await screen.findByRole('table', {
      name: 'Cancellation events by actor type and reason code',
    });
    expect(within(table).getByText('RENTER_CANCELLED')).not.toBeNull();
    expect(document.body.textContent).not.toContain('reasonText');
  });

  it('renders authoritative count trends, default metrics, zero buckets, and accessible data', async () => {
    renderDashboard();
    expect(await screen.findByText('Marketplace activity over time')).not.toBeNull();
    expect(
      screen.getByRole('img', { name: 'Marketplace activity count trend chart' }),
    ).not.toBeNull();
    expect(screen.getByText(/daily buckets/u)).not.toBeNull();
    for (const metric of ['Bookings Created', 'Rentals Started', 'Completed Rentals'])
      expect(
        screen.getByRole('button', { name: new RegExp(metric, 'u') }).getAttribute('aria-pressed'),
      ).toBe('true');
    expect(screen.getByRole('button', { name: /New Renters/u }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(document.querySelectorAll('circle[tabindex="0"]')).toHaveLength(6);
    fireEvent.click(screen.getByText('View accessible trend data'));
    const table = screen.getByRole('table', {
      name: 'Authoritative marketplace activity trend counts',
    });
    expect(within(table).getAllByText('0').length).toBeGreaterThan(0);
  });

  it('never permits the last selected trend metric to be removed', async () => {
    renderDashboard();
    await screen.findByText('Marketplace activity over time');
    fireEvent.click(screen.getByRole('button', { name: /Rentals Started/u }));
    fireEvent.click(screen.getByRole('button', { name: /Completed Rentals/u }));
    const created = screen.getByRole('button', { name: /Bookings Created/u });
    fireEvent.click(created);
    expect(created.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps summary visible when trends fail and offers a trend-only retry', async () => {
    const failedTrends = vi.fn().mockRejectedValue(new Error('private raw trend failure'));
    renderDashboard(undefined, failedTrends);
    expect(await screen.findByText('BOOKING & RENTAL ACTIVITY')).not.toBeNull();
    expect(
      screen.getByText(
        'Marketplace trends are temporarily unavailable. Summary totals remain authoritative.',
      ),
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain('private raw trend failure');
    fireEvent.click(screen.getByRole('button', { name: 'Retry trends' }));
    await waitFor(() => expect(failedTrends).toHaveBeenCalledTimes(2));
  });

  it('uses safe independent summary loading and error states', async () => {
    const pending = new Promise<OwnerMarketplaceReport>(() => undefined);
    renderDashboard(vi.fn().mockReturnValue(pending));
    expect(screen.getByText('Loading authoritative marketplace reports')).not.toBeNull();
    cleanup();
    const failed = vi.fn().mockRejectedValue(new Error('private raw report failure'));
    renderDashboard(failed);
    expect(
      await screen.findByText('Marketplace reporting is temporarily unavailable.'),
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain('private raw report failure');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(failed).toHaveBeenCalledTimes(2));
  });

  it('formats large decimal-string counts without Number conversion', () => {
    expect(formatMarketplaceCount('900719925474099300')).toBe('900,719,925,474,099,300');
  });

  it('does not duplicate finance, utilization, rankings, geography, or operational actions', async () => {
    renderDashboard();
    await screen.findByText('BOOKING & RENTAL ACTIVITY');
    for (const excluded of [
      'Gross Booking Value',
      'Rental Collections',
      'CarShare Commission',
      'Owner Earnings',
      'Utilization',
      'Top Vehicles',
      'Top Owners',
      'Geographic Performance',
      'Approve booking',
      'Suspend renter',
      'Resolve claim',
    ])
      expect(screen.queryByText(excluded)).toBeNull();
  });
});
