import { describe, expect, it } from 'vitest';
import { bookingSecurityDepositProjection } from './booking-projection.service';

describe('booking security deposit projection', () => {
  it('reports a required booking honestly while execution remains unavailable', () => {
    expect(
      bookingSecurityDepositProjection({
        policySnapshot: {
          securityDepositAmountMinor: 500_000,
          securityDepositCurrency: 'PHP',
          securityDepositRequired: true,
        },
        securityDeposit: null,
      }),
    ).toEqual({
      actionRequired: false,
      availableAt: null,
      eligibleAt: null,
      amountMinor: 500_000,
      blockingPickup: false,
      capturedMinor: 0,
      currency: 'PHP',
      executionAvailable: false,
      heldMinor: 0,
      leadHours: 48,
      isEligibleNow: false,
      releasedMinor: 0,
      required: true,
      status: 'PENDING',
    });
  });

  it('opens the renter action immediately inside the configured lead window', () => {
    const now = new Date('2026-10-04T00:00:00.000Z');
    expect(
      bookingSecurityDepositProjection({
        bookingStatus: 'CONFIRMED',
        executionAvailable: true,
        leadHours: 48,
        now,
        policySnapshot: {
          securityDepositAmountMinor: 500_000,
          securityDepositCurrency: 'PHP',
          securityDepositRequired: true,
        },
        rentalPaymentCaptured: true,
        rentalStart: new Date('2026-10-05T00:00:00.000Z'),
        securityDeposit: null,
      }),
    ).toMatchObject({ actionRequired: true, blockingPickup: true, isEligibleNow: true });
  });

  it('opens exactly at the configured eligibility boundary', () => {
    const boundary = new Date('2026-10-03T00:00:00.000Z');
    expect(
      bookingSecurityDepositProjection({
        bookingStatus: 'CONFIRMED',
        executionAvailable: true,
        leadHours: 48,
        now: boundary,
        policySnapshot: {
          securityDepositAmountMinor: 500_000,
          securityDepositCurrency: 'PHP',
          securityDepositRequired: true,
        },
        rentalPaymentCaptured: true,
        rentalStart: new Date('2026-10-05T00:00:00.000Z'),
        securityDeposit: null,
      }),
    ).toMatchObject({
      actionRequired: true,
      eligibleAt: boundary.toISOString(),
      isEligibleNow: true,
    });
  });

  it('keeps the action closed before the configured lead window', () => {
    expect(
      bookingSecurityDepositProjection({
        bookingStatus: 'CONFIRMED',
        executionAvailable: true,
        leadHours: 48,
        now: new Date('2026-10-01T00:00:00.000Z'),
        policySnapshot: {
          securityDepositAmountMinor: 500_000,
          securityDepositCurrency: 'PHP',
          securityDepositRequired: true,
        },
        rentalPaymentCaptured: true,
        rentalStart: new Date('2026-10-05T00:00:00.000Z'),
        securityDeposit: null,
      }),
    ).toMatchObject({
      actionRequired: false,
      availableAt: '2026-10-03T00:00:00.000Z',
      eligibleAt: '2026-10-03T00:00:00.000Z',
      isEligibleNow: false,
      status: 'NOT_ELIGIBLE',
    });
  });

  it('projects uncertain provider outcomes as UNKNOWN without exposing retry', () => {
    expect(
      bookingSecurityDepositProjection({
        bookingStatus: 'CONFIRMED',
        executionAvailable: true,
        now: new Date('2026-10-04T00:00:00.000Z'),
        policySnapshot: {
          securityDepositAmountMinor: 500_000,
          securityDepositCurrency: 'PHP',
          securityDepositRequired: true,
        },
        rentalPaymentCaptured: true,
        rentalStart: new Date('2026-10-05T00:00:00.000Z'),
        securityDeposit: {
          authorizedAmountMinor: 0n,
          currency: 'PHP',
          payment: {
            customerActionUrl: null,
            reconciliationRequired: true,
            status: 'AUTHORIZING',
          },
          requiredAmountMinor: 500_000n,
          status: 'AUTHORIZING',
          usedAmountMinor: 0n,
        },
      }),
    ).toMatchObject({ actionRequired: false, blockingPickup: true, status: 'UNKNOWN' });
  });

  it('keeps an abandoned provider checkout resumable without treating it as a new attempt', () => {
    expect(
      bookingSecurityDepositProjection({
        bookingStatus: 'CONFIRMED',
        executionAvailable: true,
        now: new Date('2026-10-04T00:00:00.000Z'),
        policySnapshot: {
          securityDepositAmountMinor: 500_000,
          securityDepositCurrency: 'PHP',
          securityDepositRequired: true,
        },
        rentalPaymentCaptured: true,
        rentalStart: new Date('2026-10-05T00:00:00.000Z'),
        securityDeposit: {
          authorizedAmountMinor: 0n,
          currency: 'PHP',
          payment: {
            customerActionUrl: 'https://payments-web-sandbox.maya.ph/resume',
            reconciliationRequired: true,
            status: 'AUTHORIZING',
          },
          requiredAmountMinor: 500_000n,
          status: 'AUTHORIZING',
          usedAmountMinor: 0n,
        },
      }),
    ).toMatchObject({ actionRequired: true, blockingPickup: true, status: 'AUTHORIZING' });
  });

  it('reports a no-deposit booking without lifecycle activity', () => {
    expect(
      bookingSecurityDepositProjection({
        policySnapshot: {
          securityDepositAmountMinor: null,
          securityDepositCurrency: null,
          securityDepositRequired: false,
        },
        securityDeposit: null,
      }),
    ).toMatchObject({ required: false, status: 'NOT_REQUIRED' });
  });

  it('fails safely when required snapshot terms are malformed', () => {
    expect(() =>
      bookingSecurityDepositProjection({
        policySnapshot: {
          securityDepositAmountMinor: null,
          securityDepositCurrency: null,
          securityDepositRequired: true,
        },
        securityDeposit: null,
      }),
    ).toThrow('The required security deposit snapshot is incomplete.');
  });

  it('rejects lifecycle state that does not match immutable booking terms', () => {
    expect(() =>
      bookingSecurityDepositProjection({
        policySnapshot: {
          securityDepositAmountMinor: 500_000,
          securityDepositCurrency: 'PHP',
          securityDepositRequired: true,
        },
        securityDeposit: {
          authorizedAmountMinor: 0n,
          currency: 'PHP',
          requiredAmountMinor: 1_000_000n,
          status: 'PENDING',
          usedAmountMinor: 0n,
        },
      }),
    ).toThrow('does not match the booking snapshot');
  });
});
