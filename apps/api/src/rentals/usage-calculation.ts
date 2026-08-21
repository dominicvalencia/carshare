import { InspectionConfirmationDecision } from '@carrental/database';

interface Measurement {
  readonly odometerMeters: bigint;
  readonly fuelBasisPoints: number | null;
  readonly batterySocBasisPoints: number | null;
}

export interface UsageCalculationInput {
  readonly actualReturnAt: Date;
  readonly scheduledReturnAt: Date;
  readonly pickup: Measurement;
  readonly returned: Measurement;
  readonly decision: InspectionConfirmationDecision;
  readonly pricing: {
    readonly chargeableDays: number;
    readonly unlimitedMileage: boolean;
  };
  readonly policy: {
    readonly includedKilometersPerDay: number | null;
    readonly fuelReturnPolicy: 'SAME_TO_SAME' | 'FULL_TO_FULL' | null;
    readonly fuelTolerancePercent: number | null;
    readonly evReturnPolicy: 'SAME_TO_SAME' | 'MINIMUM_PERCENTAGE' | null;
    readonly evRequiredPercentage: number | null;
    readonly evTolerancePercent: number | null;
  };
}

export function calculateBookingUsage(input: UsageCalculationInput) {
  const distanceTravelledMeters = input.returned.odometerMeters - input.pickup.odometerMeters;
  if (distanceTravelledMeters < 0n) throw new Error('Return odometer cannot precede pickup.');
  const distanceTravelledKm = Number(distanceTravelledMeters / 1000n);
  const includedDistanceKm = input.pricing.unlimitedMileage
    ? null
    : (input.policy.includedKilometersPerDay ?? 0) * input.pricing.chargeableDays;
  const fuelTolerance = (input.policy.fuelTolerancePercent ?? 0) * 100;
  const requiredFuelBasisPoints =
    input.policy.fuelReturnPolicy === 'SAME_TO_SAME'
      ? Math.max(0, (input.pickup.fuelBasisPoints ?? 0) - fuelTolerance)
      : input.policy.fuelReturnPolicy === 'FULL_TO_FULL'
        ? Math.max(0, 10000 - fuelTolerance)
        : null;
  const socTolerance = (input.policy.evTolerancePercent ?? 0) * 100;
  const requiredSocBasisPoints =
    input.policy.evReturnPolicy === 'SAME_TO_SAME'
      ? Math.max(0, (input.pickup.batterySocBasisPoints ?? 0) - socTolerance)
      : input.policy.evReturnPolicy === 'MINIMUM_PERCENTAGE'
        ? Math.max(0, (input.policy.evRequiredPercentage ?? 0) * 100 - socTolerance)
        : null;
  return {
    actualReturnAt: input.actualReturnAt,
    distanceTravelledKm,
    distanceTravelledMeters,
    excessDistanceKm:
      includedDistanceKm === null ? 0 : Math.max(0, distanceTravelledKm - includedDistanceKm),
    fuelDeficiencyBasisPoints:
      requiredFuelBasisPoints === null
        ? null
        : Math.max(0, requiredFuelBasisPoints - (input.returned.fuelBasisPoints ?? 0)),
    includedDistanceKm,
    lateDurationSeconds: Math.max(
      0,
      Math.floor((input.actualReturnAt.getTime() - input.scheduledReturnAt.getTime()) / 1000),
    ),
    pickupFuelBasisPoints: input.pickup.fuelBasisPoints,
    pickupOdometerMeters: input.pickup.odometerMeters,
    pickupSocBasisPoints: input.pickup.batterySocBasisPoints,
    requiredFuelBasisPoints,
    requiredSocBasisPoints,
    returnDisputed: input.decision === InspectionConfirmationDecision.DISAGREED,
    returnFuelBasisPoints: input.returned.fuelBasisPoints,
    returnOdometerMeters: input.returned.odometerMeters,
    returnSocBasisPoints: input.returned.batterySocBasisPoints,
    scheduledReturnAt: input.scheduledReturnAt,
    socDeficiencyBasisPoints:
      requiredSocBasisPoints === null
        ? null
        : Math.max(0, requiredSocBasisPoints - (input.returned.batterySocBasisPoints ?? 0)),
  };
}
