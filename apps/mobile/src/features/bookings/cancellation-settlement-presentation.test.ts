import { describe, expect, it } from 'vitest';
import { cancellationSettlementRows } from './cancellation-settlement-presentation';

function settlement(overrides: Partial<Parameters<typeof cancellationSettlementRows>[0]> = {}) {
  return {
    collectionRefundedMinor: '0',
    commissionRetainedMinor: '37500',
    deliveryRefundedMinor: '0',
    deliveryRetainedMinor: '0',
    ...overrides,
  };
}

describe('cancelled booking settlement presentation', () => {
  it('suppresses zero delivery and collection rows while retaining the CarShare fee', () => {
    expect(cancellationSettlementRows(settlement())).toEqual([
      { amountMinor: 37500, icon: 'receipt-outline', label: 'CarShare fee retained' },
    ]);
  });

  it('renders non-zero delivery and collection components as separate rows', () => {
    expect(
      cancellationSettlementRows(
        settlement({
          collectionRefundedMinor: '20000',
          deliveryRefundedMinor: '30000',
          deliveryRetainedMinor: '15000',
        }),
      ),
    ).toEqual([
      { amountMinor: 37500, icon: 'receipt-outline', label: 'CarShare fee retained' },
      { amountMinor: 15000, icon: 'navigate-outline', label: 'Delivery fee retained' },
      { amountMinor: 30000, icon: 'navigate-outline', label: 'Delivery fee refunded' },
      {
        amountMinor: 20000,
        icon: 'return-down-back-outline',
        label: 'Collection fee refunded',
      },
    ]);
  });

  it('does not fabricate rows for invalid or zero amounts', () => {
    expect(
      cancellationSettlementRows(
        settlement({
          collectionRefundedMinor: 'invalid',
          commissionRetainedMinor: '0',
        }),
      ),
    ).toEqual([]);
  });
});
