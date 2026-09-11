import { describe, expect, it } from 'vitest';
import { normalizeFulfillmentPolicy, validateFulfillmentPolicy } from './fulfillment-policy';

describe('fulfillment policy', () => {
  it('preserves the legacy pickup and return default', () => {
    expect(normalizeFulfillmentPolicy({})).toEqual({
      collectionFeeMinor: null,
      deliveryFeeMinor: null,
      fulfillmentMinimumNoticeMinutes: 0,
      fulfillmentServiceRadiusMeters: null,
      supportsOwnerCollection: false,
      supportsOwnerDelivery: false,
      supportsRenterPickup: true,
      supportsRenterReturn: true,
    });
    expect(validateFulfillmentPolicy({})).toBeNull();
  });

  it('accepts owner services, including an intentionally free service', () => {
    expect(
      validateFulfillmentPolicy({
        collectionFeeMinor: 0,
        deliveryFeeMinor: 12_500,
        fulfillmentMinimumNoticeMinutes: 180,
        fulfillmentServiceRadiusMeters: 10_000,
        supportsOwnerCollection: true,
        supportsOwnerDelivery: true,
      }),
    ).toBeNull();
  });

  it.each([
    [{ supportsOwnerDelivery: false, supportsRenterPickup: false }, 'rental-start'],
    [{ supportsOwnerCollection: false, supportsRenterReturn: false }, 'rental-end'],
    [{ supportsOwnerDelivery: true }, 'radius'],
    [{ fulfillmentServiceRadiusMeters: 50_001, supportsOwnerDelivery: true }, 'radius'],
    [{ fulfillmentServiceRadiusMeters: 1_000, supportsOwnerDelivery: true }, 'delivery fee'],
    [{ fulfillmentMinimumNoticeMinutes: -1 }, 'notice'],
  ])('rejects invalid policy %#', (policy, message) => {
    expect(validateFulfillmentPolicy(policy)).toContain(message);
  });
});
