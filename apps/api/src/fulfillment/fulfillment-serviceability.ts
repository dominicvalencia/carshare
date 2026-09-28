import { Injectable } from '@nestjs/common';
import { Prisma } from '@carrental/database';
import { DatabaseService } from '../infrastructure/database/database.service';

export type FulfillmentMethod =
  'RENTER_PICKUP' | 'OWNER_DELIVERY' | 'RENTER_RETURN' | 'OWNER_COLLECTION';

export type FulfillmentServiceabilityReason =
  | 'SUPPORTED'
  | 'METHOD_UNSUPPORTED'
  | 'SERVICE_RADIUS_MISSING'
  | 'OUTSIDE_SERVICE_RADIUS'
  | 'INSUFFICIENT_NOTICE'
  | 'INVALID_DESTINATION'
  | 'POLICY_UNAVAILABLE';

export interface FulfillmentServiceabilityResult {
  supported: boolean;
  withinRadius: boolean | null;
  distanceMeters: number | null;
  noticeSatisfied: boolean;
  reason: FulfillmentServiceabilityReason;
}

interface ServiceabilityPolicy {
  supportsRenterPickup: boolean;
  supportsOwnerDelivery: boolean;
  supportsRenterReturn: boolean;
  supportsOwnerCollection: boolean;
  fulfillmentServiceRadiusMeters: number | null;
  fulfillmentMinimumNoticeMinutes: number;
}

export function isValidFulfillmentDestination(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export function evaluateFulfillmentServiceability(args: {
  policy: ServiceabilityPolicy | null;
  method: FulfillmentMethod;
  distanceMeters: number | null;
  scheduledAt: Date;
  now: Date;
  destinationValid?: boolean;
}): FulfillmentServiceabilityResult {
  if (args.destinationValid === false)
    return result('INVALID_DESTINATION', false, null, null, false);
  if (!args.policy) return result('POLICY_UNAVAILABLE', false, null, null, false);

  const ownerService = args.method === 'OWNER_DELIVERY' || args.method === 'OWNER_COLLECTION';
  const methodSupported =
    (args.method === 'RENTER_PICKUP' && args.policy.supportsRenterPickup) ||
    (args.method === 'OWNER_DELIVERY' && args.policy.supportsOwnerDelivery) ||
    (args.method === 'RENTER_RETURN' && args.policy.supportsRenterReturn) ||
    (args.method === 'OWNER_COLLECTION' && args.policy.supportsOwnerCollection);
  if (!methodSupported) return result('METHOD_UNSUPPORTED', false, null, null, false);

  const noticeSatisfied =
    args.scheduledAt.getTime() - args.now.getTime() >=
    args.policy.fulfillmentMinimumNoticeMinutes * 60_000;
  if (!noticeSatisfied)
    return result(
      'INSUFFICIENT_NOTICE',
      false,
      ownerService && args.policy.fulfillmentServiceRadiusMeters && args.distanceMeters !== null
        ? args.distanceMeters <= args.policy.fulfillmentServiceRadiusMeters
        : null,
      args.distanceMeters,
      false,
    );

  if (!ownerService) return result('SUPPORTED', true, null, null, true);
  if (!args.policy.fulfillmentServiceRadiusMeters || args.distanceMeters === null)
    return result('SERVICE_RADIUS_MISSING', false, null, args.distanceMeters, true);

  const withinRadius = args.distanceMeters <= args.policy.fulfillmentServiceRadiusMeters;
  return result(
    withinRadius ? 'SUPPORTED' : 'OUTSIDE_SERVICE_RADIUS',
    withinRadius,
    withinRadius,
    args.distanceMeters,
    true,
  );
}

function result(
  reason: FulfillmentServiceabilityReason,
  supported: boolean,
  withinRadius: boolean | null,
  distanceMeters: number | null,
  noticeSatisfied: boolean,
): FulfillmentServiceabilityResult {
  return { distanceMeters, noticeSatisfied, reason, supported, withinRadius };
}

@Injectable()
export class FulfillmentServiceabilityService {
  constructor(private readonly database: DatabaseService) {}

  async evaluate(
    input: {
      policyVersionId: string;
      method: FulfillmentMethod;
      destinationLatitude: number;
      destinationLongitude: number;
      scheduledAt: Date;
      now?: Date;
    },
    transaction?: Prisma.TransactionClient,
  ): Promise<FulfillmentServiceabilityResult> {
    const client = transaction ?? this.database.client;
    const destinationValid = isValidFulfillmentDestination(
      input.destinationLatitude,
      input.destinationLongitude,
    );
    if (!destinationValid) {
      return evaluateFulfillmentServiceability({
        destinationValid: false,
        distanceMeters: null,
        method: input.method,
        now: input.now ?? new Date(),
        policy: null,
        scheduledAt: input.scheduledAt,
      });
    }

    const policy = await client.vehiclePolicyVersion.findUnique({
      select: {
        fulfillmentMinimumNoticeMinutes: true,
        fulfillmentServiceRadiusMeters: true,
        supportsOwnerCollection: true,
        supportsOwnerDelivery: true,
        supportsRenterPickup: true,
        supportsRenterReturn: true,
        vehicleId: true,
      },
      where: { id: input.policyVersionId },
    });
    if (!policy) {
      return evaluateFulfillmentServiceability({
        distanceMeters: null,
        method: input.method,
        now: input.now ?? new Date(),
        policy: null,
        scheduledAt: input.scheduledAt,
      });
    }

    let distanceMeters: number | null = null;
    if (input.method === 'OWNER_DELIVERY' || input.method === 'OWNER_COLLECTION') {
      const rows = await client.$queryRaw<Array<{ distance_meters: number }>>(
        Prisma.sql`
          SELECT ROUND(ST_Distance(
            vl.point,
            ST_SetSRID(ST_MakePoint(${input.destinationLongitude}, ${input.destinationLatitude}), 4326)::geography
          ))::integer AS distance_meters
          FROM vehicle_locations vl
          WHERE vl.vehicle_id = ${policy.vehicleId}::uuid AND vl.point IS NOT NULL
        `,
      );
      distanceMeters = rows[0]?.distance_meters ?? null;
    }

    return evaluateFulfillmentServiceability({
      distanceMeters,
      method: input.method,
      now: input.now ?? new Date(),
      policy,
      scheduledAt: input.scheduledAt,
    });
  }
}

export function legacyFulfillmentProjection(snapshot: null | undefined) {
  if (snapshot) return snapshot;
  return {
    collectionFeeMinor: 0,
    deliveryFeeMinor: 0,
    endMethod: 'RENTER_RETURN' as const,
    legacyCompatibility: true,
    startMethod: 'RENTER_PICKUP' as const,
  };
}
