export const MAX_FULFILLMENT_SERVICE_RADIUS_METERS = 50_000;
export const MAX_FULFILLMENT_NOTICE_MINUTES = 10_080;

export interface FulfillmentPolicyInput {
  supportsRenterPickup?: boolean;
  supportsOwnerDelivery?: boolean;
  supportsRenterReturn?: boolean;
  supportsOwnerCollection?: boolean;
  fulfillmentServiceRadiusMeters?: number | null;
  deliveryFeeMinor?: number | null;
  collectionFeeMinor?: number | null;
  fulfillmentMinimumNoticeMinutes?: number;
}

export interface NormalizedFulfillmentPolicy {
  supportsRenterPickup: boolean;
  supportsOwnerDelivery: boolean;
  supportsRenterReturn: boolean;
  supportsOwnerCollection: boolean;
  fulfillmentServiceRadiusMeters: number | null;
  deliveryFeeMinor: number | null;
  collectionFeeMinor: number | null;
  fulfillmentMinimumNoticeMinutes: number;
}

export function normalizeFulfillmentPolicy(
  input: FulfillmentPolicyInput,
): NormalizedFulfillmentPolicy {
  return {
    supportsRenterPickup: input.supportsRenterPickup ?? true,
    supportsOwnerDelivery: input.supportsOwnerDelivery ?? false,
    supportsRenterReturn: input.supportsRenterReturn ?? true,
    supportsOwnerCollection: input.supportsOwnerCollection ?? false,
    fulfillmentServiceRadiusMeters: input.fulfillmentServiceRadiusMeters ?? null,
    deliveryFeeMinor: input.deliveryFeeMinor ?? null,
    collectionFeeMinor: input.collectionFeeMinor ?? null,
    fulfillmentMinimumNoticeMinutes: input.fulfillmentMinimumNoticeMinutes ?? 0,
  };
}

export function validateFulfillmentPolicy(input: FulfillmentPolicyInput): string | null {
  const policy = normalizeFulfillmentPolicy(input);
  if (!policy.supportsRenterPickup && !policy.supportsOwnerDelivery) {
    return 'At least one rental-start fulfillment method must be supported.';
  }
  if (!policy.supportsRenterReturn && !policy.supportsOwnerCollection) {
    return 'At least one rental-end fulfillment method must be supported.';
  }
  const ownerService = policy.supportsOwnerDelivery || policy.supportsOwnerCollection;
  if (
    ownerService &&
    (!Number.isInteger(policy.fulfillmentServiceRadiusMeters) ||
      policy.fulfillmentServiceRadiusMeters! <= 0 ||
      policy.fulfillmentServiceRadiusMeters! > MAX_FULFILLMENT_SERVICE_RADIUS_METERS)
  ) {
    return `Owner service requires a radius from 1 to ${MAX_FULFILLMENT_SERVICE_RADIUS_METERS} meters.`;
  }
  if (
    policy.supportsOwnerDelivery &&
    (!Number.isInteger(policy.deliveryFeeMinor) || policy.deliveryFeeMinor! < 0)
  ) {
    return 'Owner delivery requires a non-negative delivery fee.';
  }
  if (
    policy.supportsOwnerCollection &&
    (!Number.isInteger(policy.collectionFeeMinor) || policy.collectionFeeMinor! < 0)
  ) {
    return 'Owner collection requires a non-negative collection fee.';
  }
  if (
    !Number.isInteger(policy.fulfillmentMinimumNoticeMinutes) ||
    policy.fulfillmentMinimumNoticeMinutes < 0 ||
    policy.fulfillmentMinimumNoticeMinutes > MAX_FULFILLMENT_NOTICE_MINUTES
  ) {
    return `Fulfillment notice must be from 0 to ${MAX_FULFILLMENT_NOTICE_MINUTES} minutes.`;
  }
  return null;
}
