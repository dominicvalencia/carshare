import { describe, expect, it } from 'vitest';
import {
  evaluateFulfillmentServiceability,
  isValidFulfillmentDestination,
  legacyFulfillmentProjection,
} from './fulfillment-serviceability';

const now = new Date('2026-09-11T00:00:00.000Z');
const scheduledAt = new Date('2026-09-11T04:00:00.000Z');
const policy = {
  fulfillmentMinimumNoticeMinutes: 120,
  fulfillmentServiceRadiusMeters: 10_000,
  supportsOwnerCollection: true,
  supportsOwnerDelivery: true,
  supportsRenterPickup: true,
  supportsRenterReturn: true,
};

describe('fulfillment serviceability', () => {
  it.each([
    [9_999, true, 'SUPPORTED'],
    [10_000, true, 'SUPPORTED'],
    [10_001, false, 'OUTSIDE_SERVICE_RADIUS'],
  ] as const)(
    'uses inclusive authoritative radius boundaries',
    (distanceMeters, supported, reason) => {
      expect(
        evaluateFulfillmentServiceability({
          distanceMeters,
          method: 'OWNER_DELIVERY',
          now,
          policy,
          scheduledAt,
        }),
      ).toMatchObject({ distanceMeters, reason, supported, withinRadius: supported });
    },
  );

  it('enforces notice and method support', () => {
    expect(
      evaluateFulfillmentServiceability({
        distanceMeters: 100,
        method: 'OWNER_COLLECTION',
        now,
        policy,
        scheduledAt: new Date('2026-09-11T01:59:59.000Z'),
      }),
    ).toMatchObject({ noticeSatisfied: false, reason: 'INSUFFICIENT_NOTICE', supported: false });
    expect(
      evaluateFulfillmentServiceability({
        distanceMeters: null,
        method: 'RENTER_PICKUP',
        now,
        policy: { ...policy, supportsRenterPickup: false },
        scheduledAt,
      }),
    ).toMatchObject({ reason: 'METHOD_UNSUPPORTED', supported: false });
  });

  it('fails closed for missing policy, radius, and invalid destinations', () => {
    expect(
      evaluateFulfillmentServiceability({
        distanceMeters: null,
        method: 'OWNER_DELIVERY',
        now,
        policy: null,
        scheduledAt,
      }),
    ).toMatchObject({ reason: 'POLICY_UNAVAILABLE', supported: false });
    expect(
      evaluateFulfillmentServiceability({
        distanceMeters: null,
        method: 'OWNER_DELIVERY',
        now,
        policy: { ...policy, fulfillmentServiceRadiusMeters: null },
        scheduledAt,
      }),
    ).toMatchObject({ reason: 'SERVICE_RADIUS_MISSING', supported: false });
    expect(isValidFulfillmentDestination(91, 121)).toBe(false);
    expect(isValidFulfillmentDestination(14.55, 121.02)).toBe(true);
  });

  it('projects a legacy booking without fabricating a persisted snapshot', () => {
    expect(legacyFulfillmentProjection(null)).toEqual({
      collectionFeeMinor: 0,
      deliveryFeeMinor: 0,
      endMethod: 'RENTER_RETURN',
      legacyCompatibility: true,
      startMethod: 'RENTER_PICKUP',
    });
  });
});
