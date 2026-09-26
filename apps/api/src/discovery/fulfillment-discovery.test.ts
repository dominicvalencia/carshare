import { describe, expect, it } from 'vitest';
import { VehicleHandoverFilter, VehicleReturnHandoverFilter } from './discovery.dto';
import {
  matchesHandoverFilter,
  matchesReturnHandoverFilter,
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

  it('filters return capabilities independently from pickup capabilities', () => {
    expect(matchesReturnHandoverFilter(policy, VehicleReturnHandoverFilter.ANY)).toBe(true);
    expect(
      matchesReturnHandoverFilter(policy, VehicleReturnHandoverFilter.RENTER_RETURN_AVAILABLE),
    ).toBe(true);
    expect(
      matchesReturnHandoverFilter(policy, VehicleReturnHandoverFilter.OWNER_COLLECTION_AVAILABLE),
    ).toBe(true);
    expect(
      matchesReturnHandoverFilter(
        { ...policy, supportsOwnerCollection: false },
        VehicleReturnHandoverFilter.OWNER_COLLECTION_AVAILABLE,
      ),
    ).toBe(false);
    expect(
      matchesReturnHandoverFilter(
        { ...policy, supportsRenterReturn: false },
        VehicleReturnHandoverFilter.RENTER_RETURN_AVAILABLE,
      ),
    ).toBe(false);
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
