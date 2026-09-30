import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BookingAmendmentsAdminPanel } from './BookingAmendmentsAdminPanel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPanel(request: ReturnType<typeof vi.fn>, detailId?: string, finance = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BookingAmendmentsAdminPanel
        can={(permission) => finance && permission === 'refunds.approve'}
        {...(detailId ? { detailId } : {})}
        request={request as never}
      />
    </QueryClientProvider>,
  );
}

const person = (id: string) => ({
  email: `${id}@example.test`,
  id,
  profile: { displayName: id, firstName: null, lastName: null },
});
const listItem = {
  acceptedAt: null,
  booking: {
    owner: person('Owner'),
    publicReference: 'CR-BOOKING',
    renter: person('Renter'),
    status: 'CONFIRMED',
    vehicle: { id: 'vehicle', make: 'Honda', model: 'City', modelYear: 2026 },
  },
  createdAt: '2026-09-30T00:00:00.000Z',
  id: '11111111-1111-1111-1111-111111111111',
  operationallyExpiredAt: '2026-09-30T02:00:00.000Z',
  scope: 'PRE_TRIP',
  settlement: {
    direction: 'REFUND',
    reconciliationRequired: true,
    status: 'RECONCILIATION_REQUIRED',
  },
  status: 'FINANCIAL_RECOVERY_PENDING',
};

describe('BookingAmendmentsAdminPanel', () => {
  it('discovers amendments with bounded filters, pagination, recovery context, and deep links', async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ items: [listItem], page: 1, pageSize: 25, total: 1, totalPages: 1 });
    renderPanel(request);
    expect(await screen.findByText('CR-BOOKING')).not.toBeNull();
    expect(screen.getByText('Operationally closed')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Open detail' }).getAttribute('href')).toContain(
      '/admin/booking-amendments/',
    );
    fireEvent.change(screen.getByLabelText('Amendment scope'), {
      target: { value: 'ACTIVE_EXTENSION' },
    });
    await waitFor(() =>
      expect(String(request.mock.calls.at(-1)?.[0])).toContain('scope=ACTIVE_EXTENSION'),
    );
    expect(
      ((await screen.findByRole('button', { name: 'Next' })) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('shows authoritative current/proposed, recovery, accounting, and no finance action to support', async () => {
    const request = vi.fn().mockResolvedValue(detailFixture());
    renderPanel(request, listItem.id);
    expect(await screen.findByText('Operationally closed — financial recovery')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Current' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Proposed' })).not.toBeNull();
    expect(screen.getByText(/AMENDMENT_REFUND_SUSPENSE/)).not.toBeNull();
    expect(screen.getByText(/Finance authorization is required/)).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Record evidence/ })).toBeNull();
  });

  it('uses the existing finance endpoint and requires a second success confirmation', async () => {
    const request = vi.fn().mockResolvedValue(detailFixture());
    renderPanel(request, listItem.id, true);
    await screen.findByRole('heading', { name: 'Manual refund reconciliation' });
    fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'SUCCEEDED' } });
    fireEvent.change(screen.getByLabelText('External reference'), {
      target: { value: 'provider-ref' },
    });
    fireEvent.change(screen.getByLabelText('Note / reason'), {
      target: { value: 'Provider confirmed refund' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record evidence' }));
    expect(await screen.findByRole('alert')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm successful refund' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/admin/finance/amendment-refunds/settlement/manual-resolution',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });
});

function detailFixture() {
  const payment = {
    amountMinor: '1000',
    capturedAmountMinor: '1000',
    currency: 'PHP',
    externalPaymentId: 'pay-safe',
    id: 'payment',
    purpose: 'RENTAL',
    provider: 'MAYA',
    reconciliationRequired: true,
    reconcileAfter: null,
    status: 'CAPTURED',
    unknownExpiresAt: null,
  };
  return {
    additionalPayment: null,
    amendment: {
      ...listItem,
      appliedAt: null,
      declinedAt: null,
      expiredAt: null,
      failureCode: 'RETURN_WON',
      paymentDeadlineAt: null,
      proposedRentalEnd: '2026-10-03T00:00:00.000Z',
      proposedRentalStart: '2026-10-01T00:00:00.000Z',
      proposedStartMethod: 'OWNER_DELIVERY',
      proposedEndMethod: 'OWNER_COLLECTION',
      policyVersion: 'v1',
      booking: {
        ...listItem.booking,
        cancellationSettlement: { amendmentRefundObligationOffsetMinor: '500', currency: 'PHP' },
        fulfillmentSnapshot: {
          startMethod: 'SELF_PICKUP',
          endMethod: 'SELF_RETURN',
          destinationSnapshot: {},
        },
        ownerEarning: {
          adjustmentAmountMinor: '0',
          currency: 'PHP',
          netEarningAmountMinor: '8000',
          status: 'PENDING',
          holds: [],
          payoutItems: [],
        },
        pricingSnapshot: { currency: 'PHP', totalMinor: '10000' },
        rentalStart: '2026-10-01T00:00:00.000Z',
        rentalEnd: '2026-10-02T00:00:00.000Z',
      },
      fulfillmentSnapshot: {
        currentEndMethod: 'SELF_RETURN',
        currentStartMethod: 'SELF_PICKUP',
        destinationSnapshot: {},
        proposedEndMethod: 'OWNER_COLLECTION',
        proposedStartMethod: 'OWNER_DELIVERY',
      },
      holds: [
        {
          id: 'hold',
          protectedStart: '2026-10-02T00:00:00.000Z',
          protectedEnd: '2026-10-03T00:00:00.000Z',
          releaseReason: 'RETURN_WON',
          status: 'RELEASED',
        },
      ],
      pricingSnapshot: {
        currency: 'PHP',
        currentCommissionMinor: '1500',
        currentOwnerEarningsMinor: '8500',
        currentTotalMinor: '10000',
        ownerEarningsDeltaMinor: '-500',
        proposedCommissionMinor: '1500',
        proposedOwnerEarningsMinor: '8000',
        proposedTotalMinor: '9500',
        renterFinancialDeltaMinor: '-500',
        pricingEngineVersion: 'v1',
      },
      settlement: {
        id: 'settlement',
        status: 'RECONCILIATION_REQUIRED',
        direction: 'REFUND',
        currency: 'PHP',
        financialDeltaMinor: '-500',
        reconciliationRequired: true,
        refund: {
          amountMinor: '500',
          completedAt: null,
          currency: 'PHP',
          externalRefundId: null,
          id: 'refund',
          payment,
          status: 'PROCESSING',
        },
        refundResolutionEvidence: [],
      },
      statusHistory: [
        {
          actorType: 'USER',
          id: 'history',
          occurredAt: '2026-09-30T00:00:00.000Z',
          reasonCode: null,
          toStatus: 'PENDING_OWNER',
        },
      ],
    },
    ledger: [
      {
        description: 'Refund suspense',
        entries: [
          {
            account: { code: 'AMENDMENT_REFUND_SUSPENSE', name: 'Amendment refund suspense' },
            amountMinor: '500',
            id: 'entry',
          },
        ],
        id: 'ledger',
        postedAt: '2026-09-30T01:00:00.000Z',
        type: 'AMENDMENT_REFUND_SUSPENSE',
      },
    ],
    manualResolutionEligible: true,
  };
}
