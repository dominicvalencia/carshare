import { describe, expect, it } from 'vitest';
import { securityDepositAuthorizationFits, securityDepositEligibility } from './payments.service';

describe('security deposit authorization policy', () => {
  const pickupAt = new Date('2026-10-10T09:00:00.000Z');

  it('opens at the server-owned lead-time boundary', () => {
    const before = securityDepositEligibility({
      leadHours: 48,
      now: new Date('2026-10-08T08:59:59.999Z'),
      pickupAt,
    });
    const boundary = securityDepositEligibility({
      leadHours: 48,
      now: new Date('2026-10-08T09:00:00.000Z'),
      pickupAt,
    });
    const inside = securityDepositEligibility({
      leadHours: 48,
      now: new Date('2026-10-09T09:00:00.000Z'),
      pickupAt,
    });

    expect(before.isEligibleNow).toBe(false);
    expect(boundary).toEqual({
      eligibleAt: new Date('2026-10-08T09:00:00.000Z'),
      isEligibleNow: true,
    });
    expect(inside.isEligibleNow).toBe(true);
  });

  it('makes a booking created inside the window immediately eligible', () => {
    expect(
      securityDepositEligibility({
        leadHours: 48,
        now: new Date('2026-10-10T08:00:00.000Z'),
        pickupAt,
      }).isEligibleNow,
    ).toBe(true);
  });

  it('requires the return and clearance buffer to fit within provider lifetime', () => {
    const common = {
      authorizationLifetimeSeconds: 6 * 24 * 60 * 60,
      clearanceBufferHours: 24,
      holdAt: new Date('2026-10-08T09:00:00.000Z'),
    };

    expect(
      securityDepositAuthorizationFits({
        ...common,
        returnAt: new Date('2026-10-13T09:00:00.000Z'),
      }),
    ).toBe(true);
    expect(
      securityDepositAuthorizationFits({
        ...common,
        returnAt: new Date('2026-10-13T09:00:00.001Z'),
      }),
    ).toBe(false);
    expect(
      securityDepositAuthorizationFits({
        ...common,
        authorizationLifetimeSeconds: null,
        returnAt: new Date('2026-10-09T09:00:00.000Z'),
      }),
    ).toBe(false);
  });
});
