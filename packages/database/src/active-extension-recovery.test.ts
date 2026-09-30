import { describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_EXTENSION_CAPTURE_RECOVERY_REASON,
  ACTIVE_EXTENSION_RETURN_BEFORE_CAPTURE_REASON,
  terminateActiveExtensionForReturn,
} from './active-extension-recovery';

function transaction(paymentStatus: 'AUTHORIZING' | 'CAPTURED') {
  const amendment = {
    bookingId: '00000000-0000-0000-0000-000000000001',
    correlationId: 'correlation',
    createdAt: new Date(),
    holds: [],
    id: '00000000-0000-0000-0000-000000000002',
    settlement: {
      additionalPaymentId: '00000000-0000-0000-0000-000000000003',
      direction: 'ADDITIONAL_PAYMENT',
      financialDeltaMinor: 500n,
    },
    status: 'OWNER_ACCEPTED_PAYMENT_PENDING',
  };
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    bookingAmendment: {
      findFirst: vi.fn().mockResolvedValue(amendment),
      update: vi.fn().mockResolvedValue(amendment),
    },
    bookingAmendmentStatusHistory: { upsert: vi.fn().mockResolvedValue({}) },
    outboxEvent: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    payment: {
      findUnique: vi.fn().mockResolvedValue({
        amountMinor: 500n,
        capturedAmountMinor: paymentStatus === 'CAPTURED' ? 500n : 0n,
        id: amendment.settlement.additionalPaymentId,
        purpose: 'ADDITIONAL_CHARGE',
        status: paymentStatus,
      }),
    },
  };
}

describe('active extension return recovery', () => {
  it('routes a captured unapplied charge to financial recovery and releases its hold', async () => {
    const tx = transaction('CAPTURED');
    const result = await terminateActiveExtensionForReturn(
      tx as never,
      '00000000-0000-0000-0000-000000000001',
    );
    expect(result).toBe('RECOVERY_PENDING');
    expect(tx.bookingAmendment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reasonCode: ACTIVE_EXTENSION_CAPTURE_RECOVERY_REASON,
          status: 'FINANCIAL_RECOVERY_PENDING',
        }),
      }),
    );
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('keeps an initiated uncertain payment recoverable after operational expiry', async () => {
    const tx = transaction('AUTHORIZING');
    const result = await terminateActiveExtensionForReturn(
      tx as never,
      '00000000-0000-0000-0000-000000000001',
    );
    expect(result).toBe('PAYMENT_PENDING');
    expect(tx.bookingAmendment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reasonCode: ACTIVE_EXTENSION_RETURN_BEFORE_CAPTURE_REASON,
          status: 'OWNER_ACCEPTED_PAYMENT_PENDING',
        }),
      }),
    );
  });

  it('does nothing when no unresolved active extension exists', async () => {
    const tx = transaction('CAPTURED');
    tx.bookingAmendment.findFirst.mockResolvedValueOnce(null);
    await expect(
      terminateActiveExtensionForReturn(tx as never, '00000000-0000-0000-0000-000000000001'),
    ).resolves.toBe('NONE');
    expect(tx.bookingAmendment.update).not.toHaveBeenCalled();
  });
});
