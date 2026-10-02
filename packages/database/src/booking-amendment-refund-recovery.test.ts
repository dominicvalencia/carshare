import {
  AmendmentRefundEvidenceOutcome,
  AmendmentRefundEvidenceType,
  BookingActorType,
  BookingAmendmentFinancialDirection,
  BookingAmendmentScope,
  BookingAmendmentSettlementStatus,
  BookingAmendmentStatus,
  BookingStatus,
  PaymentProviderCode,
  PaymentStatus,
  RefundStatus,
} from './generated/prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  amendmentOperationalExpiryBoundary,
  expireBookingRefundAmendmentForBooking,
  isRefundOperationalExpiryEligible,
  recordAmendmentRefundResolutionEvidence,
  resolveAmendmentRefundManually,
  refundAmendmentCanApplyOperationally,
} from './booking-amendment-refund-recovery';

describe('booking amendment operational refund recovery', () => {
  const originalStart = new Date('2026-10-01T10:00:00Z');
  const proposedStart = new Date('2026-10-01T12:00:00Z');
  const pickupWindowStart = new Date('2026-10-01T09:30:00Z');

  it('uses the earlier proposed-start or original pickup-eligibility boundary', () => {
    expect(
      amendmentOperationalExpiryBoundary({
        originalRentalStart: originalStart,
        pickupWindowStart,
        proposedRentalStart: proposedStart,
      }),
    ).toEqual(pickupWindowStart);
    expect(
      amendmentOperationalExpiryBoundary({
        originalRentalStart: originalStart,
        pickupWindowStart,
        proposedRentalStart: new Date('2026-10-01T09:00:00Z'),
      }),
    ).toEqual(new Date('2026-10-01T09:00:00Z'));
  });

  it('transitions only an unresolved accepted pre-trip refund at the exact boundary', () => {
    const common = {
      amendmentStatus: BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
      bookingStatus: BookingStatus.CONFIRMED,
      direction: BookingAmendmentFinancialDirection.REFUND,
      financialDeltaMinor: -100n,
      operationalBoundary: pickupWindowStart,
      scope: BookingAmendmentScope.PRE_TRIP,
      settlementStatus: BookingAmendmentSettlementStatus.RECONCILIATION_REQUIRED,
    };
    expect(
      isRefundOperationalExpiryEligible({
        ...common,
        now: new Date(pickupWindowStart.getTime() - 1),
      }),
    ).toBe(false);
    expect(isRefundOperationalExpiryEligible({ ...common, now: pickupWindowStart })).toBe(true);
    expect(
      isRefundOperationalExpiryEligible({
        ...common,
        now: new Date(pickupWindowStart.getTime() + 1),
      }),
    ).toBe(true);
    expect(
      isRefundOperationalExpiryEligible({
        ...common,
        now: pickupWindowStart,
        settlementStatus: BookingAmendmentSettlementStatus.COMPLETED,
      }),
    ).toBe(false);
  });

  it('permanently excludes financial-recovery amendments from future application', () => {
    expect(
      refundAmendmentCanApplyOperationally(BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING),
    ).toBe(false);
    expect(
      refundAmendmentCanApplyOperationally(BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING),
    ).toBe(true);
  });

  it('releases the hold and records history/outbox exactly once', async () => {
    const candidate = {
      acceptedAt: new Date('2026-09-30T00:00:00Z'),
      booking: {
        pickupWindowStart,
        rentalStart: originalStart,
        status: BookingStatus.READY_FOR_PICKUP,
      },
      bookingId: '11111111-1111-4111-8111-111111111111',
      correlationId: null,
      createdAt: new Date('2026-09-29T00:00:00Z'),
      id: '22222222-2222-4222-8222-222222222222',
      proposedRentalStart: proposedStart,
      scope: BookingAmendmentScope.PRE_TRIP,
      settlement: {
        direction: BookingAmendmentFinancialDirection.REFUND,
        financialDeltaMinor: -100n,
        status: BookingAmendmentSettlementStatus.RECONCILIATION_REQUIRED,
      },
      status: BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
    };
    const findFirst = vi.fn().mockResolvedValueOnce(candidate).mockResolvedValueOnce(null);
    const transactionMock = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      bookingAmendment: { findFirst, update: vi.fn().mockResolvedValue({}) },
      bookingAmendmentStatusHistory: { upsert: vi.fn().mockResolvedValue({}) },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const transaction = transactionMock as never;
    await expect(
      expireBookingRefundAmendmentForBooking(transaction, candidate.bookingId, pickupWindowStart),
    ).resolves.toBe(true);
    await expect(
      expireBookingRefundAmendmentForBooking(transaction, candidate.bookingId, pickupWindowStart),
    ).resolves.toBe(false);
    expect(transactionMock.bookingAmendment.update).toHaveBeenCalledTimes(1);
    expect(transactionMock.bookingAmendmentStatusHistory.upsert).toHaveBeenCalledTimes(1);
    expect(transactionMock.outboxEvent.create).toHaveBeenCalledTimes(1);
    expect(transactionMock.$queryRaw).toHaveBeenCalledTimes(4);
  });

  it('makes refund/pickup/cancellation races resolve from the locked current truth', () => {
    const common = {
      amendmentStatus: BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
      direction: BookingAmendmentFinancialDirection.REFUND,
      financialDeltaMinor: -100n,
      now: pickupWindowStart,
      operationalBoundary: pickupWindowStart,
      scope: BookingAmendmentScope.PRE_TRIP,
    };
    expect(
      isRefundOperationalExpiryEligible({
        ...common,
        bookingStatus: BookingStatus.CONFIRMED,
        settlementStatus: BookingAmendmentSettlementStatus.COMPLETED,
      }),
    ).toBe(false);
    for (const bookingStatus of [BookingStatus.ACTIVE, BookingStatus.CANCELLED]) {
      expect(
        isRefundOperationalExpiryEligible({
          ...common,
          bookingStatus,
          settlementStatus: BookingAmendmentSettlementStatus.RECONCILIATION_REQUIRED,
        }),
      ).toBe(false);
    }
  });

  it('converges identical manual evidence and rejects a conflicting retry', async () => {
    const persisted = { evidenceHash: '', id: 'evidence-id' };
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockImplementation(async () => persisted);
    const create = vi.fn().mockImplementation(async ({ data }) => {
      persisted.evidenceHash = data.evidenceHash;
      return { ...data, id: persisted.id };
    });
    const database = {
      bookingAmendmentRefundResolutionEvidence: { create, findUnique },
    } as never;
    const input = {
      actorType: BookingActorType.ADMIN,
      actorUserId: '11111111-1111-4111-8111-111111111111',
      amendmentSettlementId: '22222222-2222-4222-8222-222222222222',
      currency: 'PHP',
      evidenceAt: new Date('2026-10-01T00:00:00Z'),
      evidenceType: AmendmentRefundEvidenceType.PROVIDER_SUPPORT_CONFIRMATION,
      externalReference: 'maya-case-1',
      idempotencyKey: 'manual-refund-evidence-1',
      outcome: AmendmentRefundEvidenceOutcome.SUCCEEDED,
      provider: PaymentProviderCode.MAYA,
      resolutionNote: 'Provider confirmed the identified refund settled.',
      resolvedAmountMinor: 100n,
    };
    await recordAmendmentRefundResolutionEvidence(database, input);
    await expect(recordAmendmentRefundResolutionEvidence(database, input)).resolves.toEqual(
      persisted,
    );
    await expect(
      recordAmendmentRefundResolutionEvidence(database, {
        ...input,
        outcome: AmendmentRefundEvidenceOutcome.DEFINITIVE_FAILURE,
      }),
    ).rejects.toThrow('AMENDMENT_REFUND_EVIDENCE_IDEMPOTENCY_CONFLICT');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('atomically settles authoritative manual success without applying the amendment', async () => {
    const settlementId = '22222222-2222-4222-8222-222222222222';
    const amendmentId = '33333333-3333-4333-8333-333333333333';
    const paymentId = '44444444-4444-4444-8444-444444444444';
    const refundId = '55555555-5555-4555-8555-555555555555';
    const current = {
      amendment: {
        bookingId: '11111111-1111-4111-8111-111111111111',
        correlationId: 'correlation',
        scope: BookingAmendmentScope.PRE_TRIP,
        status: BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING,
      },
      amendmentId,
      currency: 'PHP',
      direction: BookingAmendmentFinancialDirection.REFUND,
      financialDeltaMinor: -100n,
      id: settlementId,
      refundId,
      refund: {
        amendmentSettlementId: settlementId,
        amountMinor: 100n,
        currency: 'PHP',
        id: refundId,
        operation: { id: '66666666-6666-4666-8666-666666666666' },
        payment: {
          bookingId: '11111111-1111-4111-8111-111111111111',
          capturedAmountMinor: 1_000n,
          provider: PaymentProviderCode.MAYA,
          refundedAmountMinor: 0n,
        },
        paymentId,
        status: RefundStatus.PROCESSING,
      },
    };
    const evidence = { evidenceHash: 'hash', id: 'evidence' };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
      bookingAmendmentRefundResolutionEvidence: {
        create: vi.fn().mockResolvedValue(evidence),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      bookingAmendmentSettlement: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(current),
        update: vi.fn().mockResolvedValue({}),
      },
      financialAccount: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'refund-payable', type: 'REFUND_PAYABLE' },
          { id: 'provider-receivable', type: 'PAYMENT_PROVIDER_RECEIVABLE' },
        ]),
      },
      ledgerTransaction: { upsert: vi.fn().mockResolvedValue({ id: 'ledger' }) },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
      payment: { update: vi.fn().mockResolvedValue({}) },
      paymentOperation: { update: vi.fn().mockResolvedValue({}) },
      refund: {
        findMany: vi.fn().mockResolvedValue([
          {
            amountMinor: 100n,
            operation: { status: 'SUCCEEDED' },
            status: RefundStatus.COMPLETED,
          },
        ]),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const database = {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as never;
    await expect(
      resolveAmendmentRefundManually(database, {
        actorType: BookingActorType.ADMIN,
        actorUserId: '77777777-7777-4777-8777-777777777777',
        amendmentId,
        amendmentSettlementId: settlementId,
        currency: 'PHP',
        evidenceAt: new Date('2026-10-01T00:00:00Z'),
        evidenceType: AmendmentRefundEvidenceType.PROVIDER_SUPPORT_CONFIRMATION,
        externalReference: 'provider-refund-1',
        idempotencyKey: 'manual-refund-resolution-1',
        originalPaymentId: paymentId,
        outcome: AmendmentRefundEvidenceOutcome.SUCCEEDED,
        provider: PaymentProviderCode.MAYA,
        refundId,
        resolutionNote: 'Provider support confirmed settlement.',
        resolvedAmountMinor: 100n,
      }),
    ).resolves.toMatchObject({
      refundStatus: RefundStatus.COMPLETED,
      settlementStatus: BookingAmendmentSettlementStatus.COMPLETED,
    });
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(4);
    expect(transaction.ledgerTransaction.upsert).toHaveBeenCalledTimes(1);
    expect(transaction.refund.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: RefundStatus.COMPLETED }),
      }),
    );
    expect(transaction.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: PaymentStatus.PARTIALLY_REFUNDED }),
      }),
    );
    expect(transaction.outboxEvent.create).toHaveBeenCalledTimes(1);
  });
});
