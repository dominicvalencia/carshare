import { evaluateFulfillmentServiceability } from '../fulfillment/fulfillment-serviceability';
import { VehicleHandoverFilter, VehicleReturnHandoverFilter } from './discovery.dto';

export interface PublicFulfillmentPolicy {
  readonly collectionFeeMinor: number | null;
  readonly deliveryFeeMinor: number | null;
  readonly fulfillmentMinimumNoticeMinutes: number;
  readonly fulfillmentServiceRadiusMeters: number | null;
  readonly supportsOwnerCollection: boolean;
  readonly supportsOwnerDelivery: boolean;
  readonly supportsRenterPickup: boolean;
  readonly supportsRenterReturn: boolean;
}

export function matchesHandoverFilter(
  policy: PublicFulfillmentPolicy,
  filter: VehicleHandoverFilter,
) {
  if (filter === VehicleHandoverFilter.PICKUP_AVAILABLE) return policy.supportsRenterPickup;
  if (filter === VehicleHandoverFilter.DELIVERY_AVAILABLE) return policy.supportsOwnerDelivery;
  if (filter === VehicleHandoverFilter.PICKUP_AND_DELIVERY)
    return policy.supportsRenterPickup && policy.supportsOwnerDelivery;
  return true;
}

export function matchesReturnHandoverFilter(
  policy: PublicFulfillmentPolicy,
  filter: VehicleReturnHandoverFilter,
) {
  if (filter === VehicleReturnHandoverFilter.RENTER_RETURN_AVAILABLE)
    return policy.supportsRenterReturn;
  if (filter === VehicleReturnHandoverFilter.OWNER_COLLECTION_AVAILABLE)
    return policy.supportsOwnerCollection;
  return true;
}

export function publicFulfillment(
  policy: PublicFulfillmentPolicy,
  context?: { readonly distanceMeters: number; readonly scheduledAt: Date; readonly now?: Date },
) {
  const delivery =
    policy.supportsOwnerDelivery && context
      ? evaluateFulfillmentServiceability({
          distanceMeters: Math.round(context.distanceMeters),
          method: 'OWNER_DELIVERY',
          now: context.now ?? new Date(),
          policy,
          scheduledAt: context.scheduledAt,
        })
      : null;
  return {
    collectionFeeMinor: policy.collectionFeeMinor,
    deliveryDistanceMeters:
      delivery?.distanceMeters == null ? null : Math.round(delivery.distanceMeters / 100) * 100,
    deliveryFeeMinor: policy.deliveryFeeMinor,
    deliveryToSearchLocation: delivery?.supported ?? null,
    deliveryToSearchLocationReason: delivery?.reason ?? null,
    fulfillmentMinimumNoticeMinutes: policy.fulfillmentMinimumNoticeMinutes,
    fulfillmentServiceRadiusMeters: policy.fulfillmentServiceRadiusMeters,
    ownerCollectionAvailable: policy.supportsOwnerCollection,
    ownerDeliveryAvailable: policy.supportsOwnerDelivery,
    renterPickupAvailable: policy.supportsRenterPickup,
    renterReturnAvailable: policy.supportsRenterReturn,
  };
}

export function publicSearchFulfillment(
  policy: PublicFulfillmentPolicy,
  context?: { readonly distanceMeters: number; readonly scheduledAt: Date; readonly now?: Date },
) {
  const fulfillment = publicFulfillment(policy, context);
  return {
    deliveryDistanceMeters: fulfillment.deliveryDistanceMeters,
    deliveryToSearchLocation: fulfillment.deliveryToSearchLocation,
    deliveryToSearchLocationReason: fulfillment.deliveryToSearchLocationReason,
    fulfillmentMinimumNoticeMinutes: fulfillment.fulfillmentMinimumNoticeMinutes,
    ownerDeliveryAvailable: fulfillment.ownerDeliveryAvailable,
    renterPickupAvailable: fulfillment.renterPickupAvailable,
  };
}
