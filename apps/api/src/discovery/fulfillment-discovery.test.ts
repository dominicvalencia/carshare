import { describe, expect, it } from 'vitest';
import { VehicleHandoverFilter } from './discovery.dto';
import {
  matchesHandoverFilter,
  publicFulfillment,
  publicSearchFulfillment,
} from './fulfillment-discovery';

const policy = {
  collectionFeeMinor: 2500,
  deliveryFeeMinor: 1500,
  fulfillmentMinimumNoticeMinutes: 120,
  fulfillmentServiceRadiusMeters: 10_000,
  supportsOwnerCollection: true,
  supportsOwnerDelivery: true,
  supportsRenterPickup: true,
  supportsRenterReturn: true,
};

describe('fulfillment discovery', () => {
  it('implements capability filters without treating both as a separate fulfillment method', () => {
    expect(matchesHandoverFilter(policy, VehicleHandoverFilter.ANY)).toBe(true);
    expect(matchesHandoverFilter(policy, VehicleHandoverFilter.PICKUP_AVAILABLE)).toBe(true);
    expect(matchesHandoverFilter(policy, VehicleHandoverFilter.DELIVERY_AVAILABLE)).toBe(true);
    expect(matchesHandoverFilter(policy, VehicleHandoverFilter.PICKUP_AND_DELIVERY)).toBe(true);
    expect(
      matchesHandoverFilter(
        { ...policy, supportsOwnerDelivery: false },
        VehicleHandoverFilter.PICKUP_AND_DELIVERY,
      ),
    ).toBe(false);
    expect(
      matchesHandoverFilter(
        { ...policy, supportsOwnerDelivery: false },
        VehicleHandoverFilter.PICKUP_AVAILABLE,
      ),
    ).toBe(true);
    expect(
      matchesHandoverFilter(
        { ...policy, supportsRenterPickup: false },
        VehicleHandoverFilter.DELIVERY_AVAILABLE,
      ),
    ).toBe(true);
  });

  it('uses authoritative distance and notice for contextual delivery and rounds public distance', () => {
    const context = {
      distanceMeters: 9_951,
      now: new Date('2026-09-11T00:00:00.000Z'),
      scheduledAt: new Date('2026-09-11T04:00:00.000Z'),
    };
    expect(publicSearchFulfillment(policy, context)).toEqual({
      deliveryDistanceMeters: 10_000,
      deliveryToSearchLocation: true,
      deliveryToSearchLocationReason: 'SUPPORTED',
      fulfillmentMinimumNoticeMinutes: 120,
      ownerDeliveryAvailable: true,
      renterPickupAvailable: true,
    });
    expect(publicSearchFulfillment(policy, { ...context, distanceMeters: 10_001 })).toMatchObject({
      deliveryToSearchLocation: false,
      deliveryToSearchLocationReason: 'OUTSIDE_SERVICE_RADIUS',
    });
    expect(
      publicSearchFulfillment(policy, {
        ...context,
        scheduledAt: new Date('2026-09-11T01:00:00.000Z'),
      }),
    ).toMatchObject({
      deliveryToSearchLocation: false,
      deliveryToSearchLocationReason: 'INSUFFICIENT_NOTICE',
    });
  });

  it('keeps search privacy-minimal while detail exposes only approved policy fields', () => {
    expect(publicSearchFulfillment(policy)).toEqual({
      deliveryDistanceMeters: null,
      deliveryToSearchLocation: null,
      deliveryToSearchLocationReason: null,
      fulfillmentMinimumNoticeMinutes: 120,
      ownerDeliveryAvailable: true,
      renterPickupAvailable: true,
    });
    expect(publicSearchFulfillment(policy)).not.toHaveProperty('fulfillmentServiceRadiusMeters');
    expect(publicSearchFulfillment(policy)).not.toHaveProperty('deliveryFeeMinor');
    expect(publicFulfillment(policy)).toMatchObject({
      collectionFeeMinor: 2500,
      deliveryFeeMinor: 1500,
      fulfillmentServiceRadiusMeters: 10_000,
      ownerCollectionAvailable: true,
      renterReturnAvailable: true,
    });
    expect(
      publicFulfillment({
        ...policy,
        collectionFeeMinor: null,
        deliveryFeeMinor: 0,
        supportsOwnerCollection: false,
      }),
    ).toMatchObject({
      collectionFeeMinor: null,
      deliveryFeeMinor: 0,
      ownerCollectionAvailable: false,
    });
  });
});
