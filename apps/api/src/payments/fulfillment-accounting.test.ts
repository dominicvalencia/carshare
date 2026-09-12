import { describe, expect, it } from 'vitest';
import { reconcileCaptureComponents } from './payments.service';

describe('B3 fulfillment capture reconciliation', () => {
  it.each([
    [10_000n, 0n, 0n, 10_000n],
    [10_000n, 0n, 500n, 10_500n],
    [10_000n, 300n, 0n, 10_300n],
    [10_000n, 300n, 500n, 10_800n],
    [10_000n, 0n, 0n, 10_000n],
  ])(
    'reconciles rental, delivery, and collection exactly',
    (rental, delivery, collection, total) => {
      expect(
        reconcileCaptureComponents({
          capturedTotalMinor: total,
          collectionComponentMinor: collection,
          deliveryComponentMinor: delivery,
          pricingTotalMinor: total,
          rentalComponentMinor: rental,
        }).accountedTotalMinor,
      ).toBe(total);
    },
  );

  it('fails closed when either provider capture or pricing total has an unexplained remainder', () => {
    expect(() =>
      reconcileCaptureComponents({
        capturedTotalMinor: 10_801n,
        collectionComponentMinor: 500n,
        deliveryComponentMinor: 300n,
        pricingTotalMinor: 10_800n,
        rentalComponentMinor: 10_000n,
      }),
    ).toThrow(/does not reconcile/);
  });
});
