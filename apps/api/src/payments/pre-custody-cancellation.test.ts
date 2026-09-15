import { describe, expect, it } from 'vitest';
import {
  calculatePreCustodyCancellation,
  calculatePreCustodyOwnerAdjustment,
} from './payments.service';

describe('pre-custody handover cancellation accounting', () => {
  const calculate = (
    deliveryCompleted: boolean,
    deliveryFeeMinor: bigint,
    collectionFeeMinor: bigint,
  ) =>
    calculatePreCustodyCancellation({
      capturedAmountMinor: 500_000n + deliveryFeeMinor + collectionFeeMinor,
      collectionFeeMinor,
      commissionRetainedMinor: 75_000n,
      currency: 'PHP',
      deliveryCompleted,
      deliveryFeeMinor,
      rentalComponentMinor: 500_000n,
    });

  it.each([
    ['pickup and renter return', false, 0n, 0n, '425000', '0', '0'],
    ['pickup and owner collection', false, 0n, 30_000n, '455000', '0', '30000'],
    ['completed delivery and renter return', true, 50_000n, 0n, '425000', '50000', '0'],
    ['completed delivery and owner collection', true, 50_000n, 30_000n, '455000', '50000', '30000'],
    ['uncompleted delivery and renter return', false, 50_000n, 0n, '475000', '0', '0'],
    ['uncompleted delivery and owner collection', false, 50_000n, 30_000n, '505000', '0', '30000'],
  ])(
    '%s uses the accepted components',
    (_case, completed, delivery, collection, refund, deliveryRetained, collectionRefunded) => {
      expect(calculate(completed, delivery, collection)).toMatchObject({
        collectionRefundedMinor: collectionRefunded,
        commissionRetainedMinor: '75000',
        deliveryCompleted: completed,
        deliveryRetainedMinor: deliveryRetained,
        refundAmountMinor: refund,
        rentalRefundedMinor: '425000',
      });
    },
  );

  it('rejects totals that do not reconcile and commission above rental value', () => {
    expect(() =>
      calculatePreCustodyCancellation({
        capturedAmountMinor: 1n,
        collectionFeeMinor: 0n,
        commissionRetainedMinor: 0n,
        currency: 'PHP',
        deliveryCompleted: false,
        deliveryFeeMinor: 0n,
        rentalComponentMinor: 2n,
      }),
    ).toThrow('reconcile');
    expect(() =>
      calculatePreCustodyCancellation({
        capturedAmountMinor: 2n,
        collectionFeeMinor: 0n,
        commissionRetainedMinor: 3n,
        currency: 'PHP',
        deliveryCompleted: false,
        deliveryFeeMinor: 0n,
        rentalComponentMinor: 2n,
      }),
    ).toThrow('Commission');
  });

  it('leaves only completed delivery attributable to the owner', () => {
    expect(
      505_000n +
        calculatePreCustodyOwnerAdjustment({
          currentAdjustmentMinor: 0n,
          originalNetEarningMinor: 505_000n,
          retainedDeliveryMinor: 50_000n,
        }),
    ).toBe(50_000n);
    expect(
      505_000n +
        calculatePreCustodyOwnerAdjustment({
          currentAdjustmentMinor: 0n,
          originalNetEarningMinor: 505_000n,
          retainedDeliveryMinor: 0n,
        }),
    ).toBe(0n);
  });
});
