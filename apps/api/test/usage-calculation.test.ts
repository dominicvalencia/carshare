import { describe, expect, it } from 'vitest';
import { InspectionConfirmationDecision } from '@carrental/database';
import { calculateBookingUsage } from '../src/rentals/usage-calculation';

const scheduled = new Date('2026-08-21T10:00:00.000Z');

describe('rental usage calculation', () => {
  it('uses snapshotted chargeable days and whole kilometres', () => {
    const usage = calculateBookingUsage({
      actualReturnAt: scheduled,
      decision: InspectionConfirmationDecision.AGREED,
      pickup: { batterySocBasisPoints: null, fuelBasisPoints: 10000, odometerMeters: 20_000_000n },
      policy: {
        evRequiredPercentage: null,
        evReturnPolicy: null,
        evTolerancePercent: null,
        fuelReturnPolicy: 'SAME_TO_SAME',
        fuelTolerancePercent: 5,
        includedKilometersPerDay: 150,
      },
      pricing: { chargeableDays: 3, unlimitedMileage: false },
      returned: { batterySocBasisPoints: null, fuelBasisPoints: 8500, odometerMeters: 20_520_999n },
      scheduledReturnAt: scheduled,
    });
    expect(usage).toMatchObject({
      distanceTravelledKm: 520,
      excessDistanceKm: 70,
      fuelDeficiencyBasisPoints: 1000,
      includedDistanceKm: 450,
    });
    expect(usage.distanceTravelledMeters).toBe(520_999n);
  });

  it('records EV deficiency and suppresses mileage excess for unlimited mileage', () => {
    const usage = calculateBookingUsage({
      actualReturnAt: new Date(scheduled.getTime() + 3_600_000),
      decision: InspectionConfirmationDecision.DISAGREED,
      pickup: { batterySocBasisPoints: 8000, fuelBasisPoints: null, odometerMeters: 1_000_000n },
      policy: {
        evRequiredPercentage: null,
        evReturnPolicy: 'SAME_TO_SAME',
        evTolerancePercent: 5,
        fuelReturnPolicy: null,
        fuelTolerancePercent: null,
        includedKilometersPerDay: null,
      },
      pricing: { chargeableDays: 2, unlimitedMileage: true },
      returned: { batterySocBasisPoints: 6000, fuelBasisPoints: null, odometerMeters: 1_900_000n },
      scheduledReturnAt: scheduled,
    });
    expect(usage).toMatchObject({
      excessDistanceKm: 0,
      includedDistanceKm: null,
      lateDurationSeconds: 3600,
      requiredSocBasisPoints: 7500,
      returnDisputed: true,
      socDeficiencyBasisPoints: 1500,
    });
  });
});
