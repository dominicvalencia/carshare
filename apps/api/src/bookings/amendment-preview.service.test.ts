import {
  BookingAmendmentStatus,
  BookingStatus,
  PaymentStatus,
  VehicleLifecycleStatus,
  VehicleOperationalStatus,
} from '@carrental/database';
import { describe, expect, it, vi } from 'vitest';
import { AmendmentPreviewService } from './amendment-preview.service';

const booking = {
  actualPickupAt: null,
  amendments: [],
  cancellationSettlement: null,
  commissionSnapshot: {
    calculatedCommissionMinor: 20_000n,
    calculationVersion: 'COMMISSION_BPS_V1',
    fixedAmountMinor: 0n,
    maximumAmountMinor: null,
    minimumAmountMinor: null,
    rateBasisPoints: 1_000,
    ruleId: '44444444-4444-4444-8444-444444444444',
    ruleVersion: 1,
  },
  disputes: [],
  fulfillmentSnapshot: {
    collectionFeeMinor: 0,
    endAddressLine1: null,
    endBarangay: null,
    endCity: 'Makati City',
    endCountry: 'PH',
    endLatitude: 14.55,
    endLongitude: 121.02,
    endMethod: 'RENTER_RETURN',
    endPostalCode: null,
    endProvince: 'Metro Manila',
    startAddressLine1: null,
    startBarangay: null,
    startCity: 'Makati City',
    startCountry: 'PH',
    startLatitude: 14.55,
    startLongitude: 121.02,
    startMethod: 'RENTER_PICKUP',
    startPostalCode: null,
    startProvince: 'Metro Manila',
    deliveryFeeMinor: 0,
  },
  handoverTravelEvents: [],
  id: '11111111-1111-4111-8111-111111111111',
  operationalHold: false,
  ownerEarning: { netEarningAmountMinor: 180_000n },
  payments: [
    {
      capturedAmountMinor: 200_000n,
      capturedAt: new Date('2026-09-01T00:00:00.000Z'),
      reconciliationRequired: false,
      status: PaymentStatus.CAPTURED,
    },
  ],
  policySnapshot: { turnaroundMinutes: 120 },
  pickupChallenges: [],
  postReturnClaims: [],
  pricingSnapshot: {
    chargeableDays: 2,
    currency: 'PHP',
    discountedRentalSubtotalMinor: 200_000,
    durationDiscountTier: null,
    policyVersionId: '22222222-2222-4222-8222-222222222222',
    vehicleTimezone: 'Asia/Manila',
  },
  publicReference: 'CR-2026-PREVIEW',
  rentalEnd: new Date('2026-10-03T01:00:00.000Z'),
  rentalStart: new Date('2026-10-01T01:00:00.000Z'),
  status: BookingStatus.CONFIRMED,
  updatedAt: new Date('2026-09-28T00:00:00.000Z'),
  vehicle: {
    location: { latitude: 14.55, longitude: 121.02 },
    operationalStatus: VehicleOperationalStatus.AVAILABLE,
    status: VehicleLifecycleStatus.APPROVED,
  },
  vehicleId: '33333333-3333-4333-8333-333333333333',
};

const originalPolicy = {
  collectionFeeMinor: 45_000,
  dailyRateMinor: 100_000,
  deliveryFeeMinor: 40_000,
  extendedTripDiscountBps: 1_500,
  id: '22222222-2222-4222-8222-222222222222',
  maximumRentalDays: 30,
  minimumRentalDays: 1,
  monthlyDiscountBps: 2_000,
  shortDurationDiscountBps: 500,
  turnaroundMinutes: 120,
  weeklyDiscountBps: 1_000,
};

describe('AmendmentPreviewService', () => {
  it.each([
    ['pickup earlier', '2026-09-30T01:00:00.000Z', '2026-10-03T01:00:00.000Z'],
    ['pickup later', '2026-10-02T01:00:00.000Z', '2026-10-03T01:00:00.000Z'],
    ['return earlier', '2026-10-01T01:00:00.000Z', '2026-10-02T01:00:00.000Z'],
    ['return later', '2026-10-01T01:00:00.000Z', '2026-10-04T01:00:00.000Z'],
    ['both shifted', '2026-10-02T01:00:00.000Z', '2026-10-04T01:00:00.000Z'],
  ])('previews a valid PRE_TRIP range with %s', async (_, proposedPickupAt, proposedReturnAt) => {
    const { service } = makeService(booking);
    const result = await service.previewRenter(
      '55555555-5555-4555-8555-555555555555',
      booking.publicReference,
      { proposedPickupAt, proposedReturnAt },
      new Date('2026-09-20T00:00:00.000Z'),
    );

    expect(result.proposed).toMatchObject({
      rentalEnd: proposedReturnAt,
      rentalStart: proposedPickupAt,
    });
  });

  it('returns a signed complete-trip preview without durable writes', async () => {
    const database = {
      client: {
        booking: { findFirst: vi.fn().mockResolvedValue(booking) },
        vehiclePolicyVersion: {
          findFirst: vi.fn().mockResolvedValue({ ...originalPolicy, deliveryFeeMinor: 50_000 }),
          findUnique: vi.fn().mockResolvedValue(originalPolicy),
        },
      },
    };
    const availability = { occupancyConflict: vi.fn().mockResolvedValue(null) };
    const fulfillment = { evaluate: vi.fn().mockResolvedValue({ supported: true }) };
    const configuration = {
      getOrThrow: vi.fn((key: string) => (key === 'QUOTE_TTL_MINUTES' ? 15 : 'x'.repeat(32))),
    };
    const service = new AmendmentPreviewService(
      database as never,
      availability as never,
      fulfillment as never,
      configuration as never,
    );
    const evaluatedAt = new Date('2026-09-20T00:00:00.000Z');

    const result = await service.previewRenter(
      '55555555-5555-4555-8555-555555555555',
      booking.publicReference,
      { proposedReturnAt: '2026-10-04T01:00:00.000Z' },
      evaluatedAt,
    );

    expect(result.proposed).toMatchObject({
      chargeableDays: 3,
      durationDiscount: { tier: 'SHORT_3_DAY' },
      rentalMinor: '285000',
    });
    expect(result.financial).toMatchObject({
      additionalPaymentMinor: '85000',
      expectedRefundMinor: '0',
    });
    expect(result.warnings).toEqual(['DURATION_DISCOUNT_APPLIED', 'ADDITIONAL_PAYMENT_REQUIRED']);
    expect(new Date(result.expiresAt).getTime() - evaluatedAt.getTime()).toBe(15 * 60_000);
    await expect(
      service.verifyPreviewToken(
        result.previewToken,
        '55555555-5555-4555-8555-555555555555',
        booking.publicReference,
        new Date('2026-09-20T00:14:59.000Z'),
      ),
    ).resolves.toMatchObject({ bookingId: booking.id });
    expect(availability.occupancyConflict).toHaveBeenCalledWith(
      expect.objectContaining({ excludeBookingId: booking.id }),
    );
  });

  it('distinguishes expiry and signature tampering', async () => {
    const database = {
      client: {
        booking: { findFirst: vi.fn().mockResolvedValue(booking) },
        vehiclePolicyVersion: {
          findFirst: vi.fn().mockResolvedValue(originalPolicy),
          findUnique: vi.fn().mockResolvedValue(originalPolicy),
        },
      },
    };
    const service = new AmendmentPreviewService(
      database as never,
      { occupancyConflict: vi.fn().mockResolvedValue(null) } as never,
      { evaluate: vi.fn().mockResolvedValue({ supported: true }) } as never,
      {
        getOrThrow: vi.fn((key: string) => (key === 'QUOTE_TTL_MINUTES' ? 15 : 'x'.repeat(32))),
      } as never,
    );
    const result = await service.previewRenter(
      '55555555-5555-4555-8555-555555555555',
      booking.publicReference,
      { proposedReturnAt: '2026-10-04T01:00:00.000Z' },
      new Date('2026-09-20T00:00:00.000Z'),
    );

    await expect(
      service.verifyPreviewToken(
        result.previewToken,
        '55555555-5555-4555-8555-555555555555',
        booking.publicReference,
        new Date('2026-09-20T00:15:00.000Z'),
      ),
    ).rejects.toMatchObject({ code: 'QUOTE_EXPIRED' });
    await expect(
      service.verifyPreviewToken(
        `${result.previewToken}x`,
        '55555555-5555-4555-8555-555555555555',
        booking.publicReference,
      ),
    ).rejects.toMatchObject({ code: 'AMENDMENT_PREVIEW_INVALID' });
  });

  it('binds renter, booking, canonical proposal, financial result, and policy authority', async () => {
    const { service } = makeService(booking);
    const renter = '55555555-5555-4555-8555-555555555555';
    const result = await service.previewRenter(
      renter,
      booking.publicReference,
      {
        proposedCollectionDestination: destination,
        proposedEndMethod: 'OWNER_COLLECTION',
        proposedReturnAt: '2026-10-04T01:00:00.000Z',
      },
      new Date('2026-09-20T00:00:00.000Z'),
    );
    const claims = decodeClaims(result.previewToken);
    const verificationTime = new Date('2026-09-20T00:01:00.000Z');

    await expect(
      service.verifyPreviewToken(
        result.previewToken,
        renter,
        booking.publicReference,
        verificationTime,
        {
          financial: claims.financial,
          policyDigest: claims.policyDigest,
          proposal: claims.proposal,
        },
      ),
    ).resolves.toMatchObject({ bookingId: booking.id });
    await expect(
      service.verifyPreviewToken(
        result.previewToken,
        renter,
        booking.publicReference,
        verificationTime,
      ),
    ).resolves.toMatchObject({ bookingId: booking.id });
    await expect(
      service.verifyPreviewToken(
        result.previewToken,
        '66666666-6666-4666-8666-666666666666',
        booking.publicReference,
        verificationTime,
      ),
    ).rejects.toMatchObject({ code: 'AMENDMENT_PREVIEW_INVALID' });
    await expect(
      service.verifyPreviewToken(result.previewToken, renter, 'CR-2026-OTHER', verificationTime),
    ).rejects.toMatchObject({ code: 'AMENDMENT_PREVIEW_INVALID' });

    for (const expected of [
      { proposal: { ...claims.proposal, rentalStart: '2026-10-01T02:00:00.000Z' } },
      { proposal: { ...claims.proposal, rentalEnd: '2026-10-05T01:00:00.000Z' } },
      { proposal: { ...claims.proposal, startMethod: 'OWNER_DELIVERY' as const } },
      { proposal: { ...claims.proposal, endMethod: 'RENTER_RETURN' as const } },
      {
        proposal: {
          ...claims.proposal,
          collectionDestination: { ...claims.proposal.collectionDestination!, city: 'Taguig City' },
        },
      },
      { financial: { ...claims.financial, additionalPaymentMinor: '1' } },
      { policyDigest: `${claims.policyDigest.slice(0, -1)}0` },
    ]) {
      await expect(
        service.verifyPreviewToken(
          result.previewToken,
          renter,
          booking.publicReference,
          verificationTime,
          expected,
        ),
      ).rejects.toMatchObject({ code: 'AMENDMENT_PREVIEW_INVALID' });
    }
    expect(JSON.stringify(claims)).not.toContain('ownerEarnings');
    expect(JSON.stringify(claims)).not.toContain('commissionRuleId');
  });

  it('uses configured TTL and exact before/at-expiry semantics', async () => {
    const { configuration, service } = makeService(booking, originalPolicy, 7);
    const issuedAt = new Date('2026-09-20T00:00:00.000Z');
    const result = await service.previewRenter(
      '55555555-5555-4555-8555-555555555555',
      booking.publicReference,
      { proposedReturnAt: '2026-10-04T01:00:00.000Z' },
      issuedAt,
    );
    expect(configuration.getOrThrow).toHaveBeenCalledWith('QUOTE_TTL_MINUTES', { infer: true });
    expect(configuration.getOrThrow).toHaveBeenCalledWith('TOKEN_HASH_SECRET', { infer: true });
    expect(new Date(result.expiresAt).getTime() - issuedAt.getTime()).toBe(7 * 60_000);
    await expect(
      service.verifyPreviewToken(
        result.previewToken,
        '55555555-5555-4555-8555-555555555555',
        booking.publicReference,
        new Date('2026-09-20T00:06:59.999Z'),
      ),
    ).resolves.toBeDefined();
    await expect(
      service.verifyPreviewToken(
        result.previewToken,
        '55555555-5555-4555-8555-555555555555',
        booking.publicReference,
        new Date('2026-09-20T00:07:00.000Z'),
      ),
    ).rejects.toMatchObject({ code: 'QUOTE_EXPIRED' });
  });

  it('detects relevant CURRENT-position changes but ignores terminal history and broad timestamps', async () => {
    const fixture = makeService(booking);
    const renter = '55555555-5555-4555-8555-555555555555';
    const result = await fixture.service.previewRenter(
      renter,
      booking.publicReference,
      { proposedReturnAt: '2026-10-04T01:00:00.000Z' },
      new Date('2026-09-20T00:00:00.000Z'),
    );
    const verify = () =>
      fixture.service.verifyPreviewToken(
        result.previewToken,
        renter,
        booking.publicReference,
        new Date('2026-09-20T00:01:00.000Z'),
      );

    fixture.database.client.booking.findFirst.mockResolvedValue({
      ...booking,
      amendments: [
        {
          ...appliedAmendment({
            appliedAt: '2026-09-20T00:00:30.000Z',
            id: '99999999-9999-4999-8999-999999999999',
            proposedChargeableDays: 3,
            proposedCommissionMinor: 28_500n,
            proposedEnd: '2026-10-04T01:00:00.000Z',
            proposedOwnerEarningsMinor: 256_500n,
            proposedRentalMinor: 285_000n,
          }),
        },
      ],
    });
    await expect(verify()).rejects.toMatchObject({ code: 'BOOKING_STATE_CHANGED' });

    fixture.database.client.booking.findFirst.mockResolvedValue({
      ...booking,
      fulfillmentSnapshot: { ...booking.fulfillmentSnapshot, endMethod: 'OWNER_COLLECTION' },
    });
    await expect(verify()).rejects.toMatchObject({ code: 'BOOKING_STATE_CHANGED' });

    fixture.database.client.booking.findFirst.mockResolvedValue({
      ...booking,
      ownerEarning: { netEarningAmountMinor: 170_000n },
    });
    await expect(verify()).rejects.toMatchObject({ code: 'BOOKING_STATE_CHANGED' });

    fixture.database.client.booking.findFirst.mockResolvedValue({
      ...booking,
      status: BookingStatus.CANCELLED,
    });
    await expect(verify()).rejects.toMatchObject({ code: 'BOOKING_STATE_CHANGED' });

    fixture.database.client.booking.findFirst.mockResolvedValue({
      ...booking,
      amendments: [
        {
          ...appliedAmendment({
            appliedAt: '2026-09-20T00:00:30.000Z',
            id: '88888888-8888-4888-8888-888888888888',
            proposedChargeableDays: 20,
            proposedCommissionMinor: 1n,
            proposedEnd: '2026-10-21T01:00:00.000Z',
            proposedOwnerEarningsMinor: 1n,
            proposedRentalMinor: 1n,
          }),
          status: BookingAmendmentStatus.DECLINED,
        },
      ],
      updatedAt: new Date('2026-09-20T00:00:45.000Z'),
    });
    await expect(verify()).resolves.toBeDefined();
  });

  it('keeps an unchanged ACTIVE extension preview valid through review', async () => {
    const activeBooking = {
      ...booking,
      actualPickupAt: new Date('2026-10-01T01:05:00.000Z'),
      status: BookingStatus.ACTIVE,
    };
    const { service } = makeService(activeBooking);
    const renter = '55555555-5555-4555-8555-555555555555';
    const preview = await service.previewRenter(
      renter,
      activeBooking.publicReference,
      { proposedReturnAt: '2026-10-04T01:00:00.000Z' },
      new Date('2026-10-02T00:00:00.000Z'),
    );

    await expect(
      service.verifyPreviewToken(
        preview.previewToken,
        renter,
        activeBooking.publicReference,
        new Date('2026-10-02T00:01:00.000Z'),
      ),
    ).resolves.toMatchObject({ bookingId: activeBooking.id });
  });

  it('does not invalidate an ACTIVE extension preview for an unrelated updatedAt write', async () => {
    const activeBooking = {
      ...booking,
      actualPickupAt: new Date('2026-10-01T01:05:00.000Z'),
      status: BookingStatus.ACTIVE,
    };
    const fixture = makeService(activeBooking);
    const renter = '55555555-5555-4555-8555-555555555555';
    const preview = await fixture.service.previewRenter(
      renter,
      activeBooking.publicReference,
      { proposedReturnAt: '2026-10-04T01:00:00.000Z' },
      new Date('2026-10-02T00:00:00.000Z'),
    );
    fixture.database.client.booking.findFirst.mockResolvedValue({
      ...activeBooking,
      updatedAt: new Date('2026-10-02T00:00:30.000Z'),
    });

    await expect(
      fixture.service.verifyPreviewToken(
        preview.previewToken,
        renter,
        activeBooking.publicReference,
        new Date('2026-10-02T00:01:00.000Z'),
      ),
    ).resolves.toBeDefined();
  });

  it.each([
    ['rentalEnd', { rentalEnd: new Date('2026-10-03T02:00:00.000Z') }],
    ['status', { status: BookingStatus.RETURN_PENDING }],
  ])('invalidates an ACTIVE extension preview after a material %s change', async (_, change) => {
    const activeBooking = {
      ...booking,
      actualPickupAt: new Date('2026-10-01T01:05:00.000Z'),
      status: BookingStatus.ACTIVE,
    };
    const fixture = makeService(activeBooking);
    const renter = '55555555-5555-4555-8555-555555555555';
    const preview = await fixture.service.previewRenter(
      renter,
      activeBooking.publicReference,
      { proposedReturnAt: '2026-10-04T01:00:00.000Z' },
      new Date('2026-10-02T00:00:00.000Z'),
    );
    fixture.database.client.booking.findFirst.mockResolvedValue({ ...activeBooking, ...change });

    await expect(
      fixture.service.verifyPreviewToken(
        preview.previewToken,
        renter,
        activeBooking.publicReference,
        new Date('2026-10-02T00:01:00.000Z'),
      ),
    ).rejects.toMatchObject({ code: 'BOOKING_STATE_CHANGED' });
  });

  it('reports missing financial authority without claiming the preview became stale', async () => {
    const { service } = makeService({ ...booking, ownerEarning: null });

    await expect(
      service.previewRenter(
        '55555555-5555-4555-8555-555555555555',
        booking.publicReference,
        { proposedReturnAt: '2026-10-04T01:00:00.000Z' },
        new Date('2026-09-20T00:00:00.000Z'),
      ),
    ).rejects.toMatchObject({ code: 'BOOKING_FINANCIAL_AUTHORITY_UNAVAILABLE' });
  });

  it('reconstructs sequential CURRENT position in appliedAt/id order and excludes terminal history', async () => {
    const appliedEarlier = appliedAmendment({
      appliedAt: '2026-09-21T00:00:00.000Z',
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      proposedChargeableDays: 3,
      proposedCommissionMinor: 28_500n,
      proposedEnd: '2026-10-04T01:00:00.000Z',
      proposedOwnerEarningsMinor: 256_500n,
      proposedRentalMinor: 285_000n,
    });
    const appliedLater = appliedAmendment({
      appliedAt: '2026-09-22T00:00:00.000Z',
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      proposedChargeableDays: 4,
      proposedCommissionMinor: 38_000n,
      proposedEnd: '2026-10-05T01:00:00.000Z',
      proposedOwnerEarningsMinor: 342_000n,
      proposedRentalMinor: 380_000n,
    });
    const terminalHistory = [
      BookingAmendmentStatus.DECLINED,
      BookingAmendmentStatus.WITHDRAWN,
      BookingAmendmentStatus.EXPIRED,
      BookingAmendmentStatus.FAILED,
    ].map((status) => ({
      ...appliedAmendment({
        appliedAt: '2026-09-23T00:00:00.000Z',
        id: `terminal-${status}`,
        proposedChargeableDays: 20,
        proposedCommissionMinor: 1n,
        proposedEnd: '2026-10-21T01:00:00.000Z',
        proposedOwnerEarningsMinor: 1n,
        proposedRentalMinor: 1n,
      }),
      status,
    }));
    const sequentialBooking = {
      ...booking,
      amendments: [...terminalHistory, appliedLater, appliedEarlier],
    };
    const { service } = makeService(sequentialBooking, {
      ...originalPolicy,
      dailyRateMinor: 999_999,
      shortDurationDiscountBps: 0,
    });

    const result = await service.previewRenter(
      '55555555-5555-4555-8555-555555555555',
      booking.publicReference,
      { proposedReturnAt: '2026-10-08T01:00:00.000Z' },
      new Date('2026-09-20T00:00:00.000Z'),
    );

    expect(result.current).toMatchObject({ chargeableDays: 4, totalMinor: '380000' });
    expect(200_000 + (285_000 - 200_000) + (380_000 - 285_000)).toBe(380_000);
    expect(result.proposed).toMatchObject({
      chargeableDays: 7,
      durationDiscount: { tier: 'WEEKLY_7_DAY' },
      rentalMinor: '630000',
    });
    expect(result.financial).toMatchObject({
      additionalPaymentMinor: '250000',
      expectedRefundMinor: '0',
    });
  });

  it('prices a 2→3 APPLIED extension followed by a 3→4 preview from CURRENT', async () => {
    const applied = appliedAmendment({
      appliedAt: '2026-09-21T00:00:00.000Z',
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      proposedChargeableDays: 3,
      proposedCommissionMinor: 28_500n,
      proposedEnd: '2026-10-04T01:00:00.000Z',
      proposedOwnerEarningsMinor: 256_500n,
      proposedRentalMinor: 285_000n,
    });
    const { service } = makeService({ ...booking, amendments: [applied] });
    const result = await service.previewRenter(
      '55555555-5555-4555-8555-555555555555',
      booking.publicReference,
      { proposedReturnAt: '2026-10-05T01:00:00.000Z' },
      new Date('2026-09-20T00:00:00.000Z'),
    );

    expect(result.current).toMatchObject({ chargeableDays: 3, totalMinor: '285000' });
    expect(result.proposed).toMatchObject({ chargeableDays: 4, rentalMinor: '380000' });
    expect(result.financial.additionalPaymentMinor).toBe('95000');
  });

  it('prices a 2→3 APPLIED discount followed by a 3→7 threshold preview from CURRENT', async () => {
    const applied = appliedAmendment({
      appliedAt: '2026-09-21T00:00:00.000Z',
      id: 'abababab-abab-4bab-8bab-abababababab',
      proposedChargeableDays: 3,
      proposedCommissionMinor: 28_500n,
      proposedEnd: '2026-10-04T01:00:00.000Z',
      proposedOwnerEarningsMinor: 256_500n,
      proposedRentalMinor: 285_000n,
    });
    const { service } = makeService({ ...booking, amendments: [applied] });
    const result = await service.previewRenter(
      '55555555-5555-4555-8555-555555555555',
      booking.publicReference,
      { proposedReturnAt: '2026-10-08T01:00:00.000Z' },
      new Date('2026-09-20T00:00:00.000Z'),
    );

    expect(result.current).toMatchObject({ chargeableDays: 3, totalMinor: '285000' });
    expect(result.proposed).toMatchObject({
      chargeableDays: 7,
      durationDiscount: { tier: 'WEEKLY_7_DAY' },
      rentalMinor: '630000',
    });
    expect(result.financial.additionalPaymentMinor).toBe('345000');
  });

  it('uses original capture/pickup clock after an applied extension and retains non-refundable rental', async () => {
    const extension = {
      ...appliedAmendment({
        appliedAt: '2026-09-27T00:00:00.000Z',
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        proposedChargeableDays: 4,
        proposedCommissionMinor: 38_000n,
        proposedEnd: '2026-10-05T05:00:00.000Z',
        proposedOwnerEarningsMinor: 342_000n,
        proposedRentalMinor: 380_000n,
      }),
      proposedRentalStart: new Date('2026-10-01T05:00:00.000Z'),
    };
    const { service } = makeService({ ...booking, amendments: [extension] });
    const result = await service.previewRenter(
      '55555555-5555-4555-8555-555555555555',
      booking.publicReference,
      { proposedReturnAt: '2026-10-04T05:00:00.000Z' },
      new Date('2026-09-28T01:00:00.000Z'),
    );

    expect(result.current).toMatchObject({ chargeableDays: 4, totalMinor: '380000' });
    expect(result.proposed).toMatchObject({ chargeableDays: 3, rentalMinor: '285000' });
    expect(result.financial).toMatchObject({
      additionalPaymentMinor: '0',
      expectedRefundMinor: '0',
      retainedNonRefundableRentalMinor: '95000',
    });
  });

  it('rejects an applied financial snapshot in a currency inconsistent with the booking', async () => {
    const applied = appliedAmendment({
      appliedAt: '2026-09-21T00:00:00.000Z',
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      proposedChargeableDays: 3,
      proposedCommissionMinor: 28_500n,
      proposedEnd: '2026-10-04T01:00:00.000Z',
      proposedOwnerEarningsMinor: 256_500n,
      proposedRentalMinor: 285_000n,
    });
    applied.pricingSnapshot.currency = 'USD';
    const { service } = makeService({ ...booking, amendments: [applied] });
    await expect(
      service.previewRenter(
        '55555555-5555-4555-8555-555555555555',
        booking.publicReference,
        { proposedReturnAt: '2026-10-05T01:00:00.000Z' },
        new Date('2026-09-20T00:00:00.000Z'),
      ),
    ).rejects.toMatchObject({ code: 'BOOKING_STATE_CHANGED' });
  });

  it.each([
    [
      { proposedStartMethod: 'OWNER_DELIVERY' as const, proposedDeliveryDestination: destination },
      '40000',
    ],
    [
      {
        proposedEndMethod: 'OWNER_COLLECTION' as const,
        proposedCollectionDestination: destination,
      },
      '45000',
    ],
  ])('adds a supported Owner fulfillment service from current policy', async (input, fee) => {
    const { fulfillment, service } = makeService(booking);
    const result = await service.previewRenter(
      '55555555-5555-4555-8555-555555555555',
      booking.publicReference,
      input,
      new Date('2026-09-20T00:00:00.000Z'),
    );
    expect(result.proposed.fulfillmentMinor).toBe(fee);
    expect(result.financial.additionalPaymentMinor).toBe(fee);
    expect(fulfillment.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ now: new Date('2026-09-20T00:00:00.000Z') }),
    );
  });

  it('requires a destination for Owner service and fails closed for capability/provider errors', async () => {
    const missing = makeService(booking);
    await expect(
      missing.service.previewRenter(
        '55555555-5555-4555-8555-555555555555',
        booking.publicReference,
        { proposedStartMethod: 'OWNER_DELIVERY' },
        new Date('2026-09-20T00:00:00.000Z'),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      missing.service.previewRenter(
        '55555555-5555-4555-8555-555555555555',
        booking.publicReference,
        { proposedDeliveryDestination: null, proposedStartMethod: 'OWNER_DELIVERY' },
        new Date('2026-09-20T00:00:00.000Z'),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const unsupported = makeService(booking);
    unsupported.fulfillment.evaluate.mockResolvedValue({
      reason: 'METHOD_UNSUPPORTED',
      supported: false,
    });
    await expect(
      unsupported.service.previewRenter(
        '55555555-5555-4555-8555-555555555555',
        booking.publicReference,
        { proposedDeliveryDestination: destination, proposedStartMethod: 'OWNER_DELIVERY' },
        new Date('2026-09-20T00:00:00.000Z'),
      ),
    ).rejects.toMatchObject({ code: 'FULFILLMENT_UNAVAILABLE' });

    const outside = makeService(booking);
    outside.fulfillment.evaluate.mockResolvedValue({
      reason: 'OUTSIDE_SERVICE_RADIUS',
      supported: false,
    });
    await expect(
      outside.service.previewRenter(
        '55555555-5555-4555-8555-555555555555',
        booking.publicReference,
        { proposedDeliveryDestination: destination, proposedStartMethod: 'OWNER_DELIVERY' },
        new Date('2026-09-20T00:00:00.000Z'),
      ),
    ).rejects.toMatchObject({ code: 'DESTINATION_NOT_SERVICEABLE' });

    const providerFailure = makeService(booking);
    providerFailure.fulfillment.evaluate.mockRejectedValue(new Error('provider-secret'));
    await expect(
      providerFailure.service.previewRenter(
        '55555555-5555-4555-8555-555555555555',
        booking.publicReference,
        { proposedCollectionDestination: destination, proposedEndMethod: 'OWNER_COLLECTION' },
        new Date('2026-09-20T00:00:00.000Z'),
      ),
    ).rejects.toMatchObject({
      code: 'FULFILLMENT_UNAVAILABLE',
      message: 'The requested handover option is unavailable.',
    });
  });

  it('removes unperformed fulfillment, clears its destination, and keeps historical fee authority', async () => {
    const deliveredBooking = {
      ...booking,
      fulfillmentSnapshot: {
        ...booking.fulfillmentSnapshot,
        deliveryFeeMinor: 40_000,
        startMethod: 'OWNER_DELIVERY',
      },
    };
    for (const proposedDeliveryDestination of [undefined, null]) {
      const { service } = makeService(deliveredBooking);
      const result = await service.previewRenter(
        '55555555-5555-4555-8555-555555555555',
        booking.publicReference,
        {
          proposedDeliveryDestination,
          proposedStartMethod: 'RENTER_PICKUP',
        },
        new Date('2026-09-20T00:00:00.000Z'),
      );
      expect(result.current.totalMinor).toBe('240000');
      expect(result.proposed).toMatchObject({
        fulfillmentMinor: '0',
        startMethod: 'RENTER_PICKUP',
      });
      expect(result.financial.expectedRefundMinor).toBe('40000');
    }
  });

  it('rejects removal after authoritative service-performance evidence exists', async () => {
    const { service } = makeService({
      ...booking,
      fulfillmentSnapshot: {
        ...booking.fulfillmentSnapshot,
        deliveryFeeMinor: 40_000,
        startMethod: 'OWNER_DELIVERY',
      },
      handoverTravelEvents: [{ phase: 'START', status: 'ARRIVED' }],
    });
    await expect(
      service.previewRenter(
        '55555555-5555-4555-8555-555555555555',
        booking.publicReference,
        { proposedStartMethod: 'RENTER_PICKUP' },
        new Date('2026-09-20T00:00:00.000Z'),
      ),
    ).rejects.toMatchObject({ code: 'FULFILLMENT_UNAVAILABLE' });
  });

  it('removes unperformed Owner collection and clears the collection destination', async () => {
    const { service } = makeService({
      ...booking,
      fulfillmentSnapshot: {
        ...booking.fulfillmentSnapshot,
        collectionFeeMinor: 45_000,
        endMethod: 'OWNER_COLLECTION',
      },
    });
    const result = await service.previewRenter(
      '55555555-5555-4555-8555-555555555555',
      booking.publicReference,
      { proposedCollectionDestination: null, proposedEndMethod: 'RENTER_RETURN' },
      new Date('2026-09-20T00:00:00.000Z'),
    );
    expect(result.proposed).toMatchObject({ endMethod: 'RENTER_RETURN', fulfillmentMinor: '0' });
    expect(result.financial.expectedRefundMinor).toBe('45000');
  });

  it('uses sequential APPLIED fulfillment history and permits removing its unperformed service', async () => {
    const applied = {
      ...appliedAmendment({
        appliedAt: '2026-09-21T00:00:00.000Z',
        id: '12121212-1212-4212-8212-121212121212',
        proposedChargeableDays: 2,
        proposedCommissionMinor: 20_000n,
        proposedEnd: '2026-10-03T01:00:00.000Z',
        proposedOwnerEarningsMinor: 220_000n,
        proposedRentalMinor: 200_000n,
      }),
      fulfillmentSnapshot: {
        currency: 'PHP',
        destinationSnapshot: { deliveryDestination: destination },
        proposedFulfillmentTotalMinor: 40_000n,
        serviceabilitySnapshot: {
          proposedCollectionFeeMinor: '0',
          proposedDeliveryFeeMinor: '40000',
        },
      },
      proposedStartMethod: 'OWNER_DELIVERY',
      settlement: { proposedTotalMinor: 240_000n },
    };
    const { service } = makeService({ ...booking, amendments: [applied] });
    const result = await service.previewRenter(
      '55555555-5555-4555-8555-555555555555',
      booking.publicReference,
      { proposedDeliveryDestination: null, proposedStartMethod: 'RENTER_PICKUP' },
      new Date('2026-09-20T00:00:00.000Z'),
    );
    expect(result.current).toMatchObject({ startMethod: 'OWNER_DELIVERY', totalMinor: '240000' });
    expect(result.proposed).toMatchObject({ fulfillmentMinor: '0', startMethod: 'RENTER_PICKUP' });
    expect(result.financial.expectedRefundMinor).toBe('40000');
  });

  it('evaluates an extension plus Owner collection as one canonical proposal', async () => {
    const { availability, fulfillment, service } = makeService(booking);
    const result = await service.previewRenter(
      '55555555-5555-4555-8555-555555555555',
      booking.publicReference,
      {
        proposedCollectionDestination: destination,
        proposedEndMethod: 'OWNER_COLLECTION',
        proposedReturnAt: '2026-10-04T01:00:00.000Z',
      },
      new Date('2026-09-20T00:00:00.000Z'),
    );
    expect(result.proposed).toMatchObject({
      chargeableDays: 3,
      endMethod: 'OWNER_COLLECTION',
      fulfillmentMinor: '45000',
      rentalMinor: '285000',
    });
    expect(result.financial.additionalPaymentMinor).toBe('130000');
    expect(availability.occupancyConflict).toHaveBeenCalledOnce();
    expect(fulfillment.evaluate).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ reason: 'BOOKING_RESERVED', turnaroundOnly: false }, 'RETURN_TIME_UNAVAILABLE'],
    [{ reason: 'AMENDMENT_HELD', turnaroundOnly: false }, 'RETURN_TIME_UNAVAILABLE'],
    [{ reason: 'BOOKING_RESERVED', turnaroundOnly: true }, 'PREPARATION_TIME_CONFLICT'],
    [{ reason: 'OWNER_BLOCKED', turnaroundOnly: false }, 'VEHICLE_UNAVAILABLE'],
    [{ reason: 'MAINTENANCE', turnaroundOnly: false }, 'VEHICLE_UNAVAILABLE'],
  ] as const)('classifies a privacy-safe return conflict', async (conflict, code) => {
    const { availability, service } = makeService(booking);
    availability.occupancyConflict.mockResolvedValue(conflict);
    await expect(
      service.previewRenter(
        '55555555-5555-4555-8555-555555555555',
        booking.publicReference,
        { proposedReturnAt: '2026-10-04T01:00:00.000Z' },
        new Date('2026-09-20T00:00:00.000Z'),
      ),
    ).rejects.toMatchObject({ code });
  });

  it('uses broad DATES_UNAVAILABLE when a conflict is not provably return-only', async () => {
    const { availability, service } = makeService(booking);
    availability.occupancyConflict.mockResolvedValue({
      reason: 'BOOKING_RESERVED',
      turnaroundOnly: false,
    });
    await expect(
      service.previewRenter(
        '55555555-5555-4555-8555-555555555555',
        booking.publicReference,
        { proposedPickupAt: '2026-10-01T02:00:00.000Z' },
        new Date('2026-09-20T00:00:00.000Z'),
      ),
    ).rejects.toMatchObject({ code: 'DATES_UNAVAILABLE' });
  });
});

const destination = {
  city: 'Makati City',
  country: 'PH',
  latitude: 14.55,
  longitude: 121.02,
  province: 'Metro Manila',
};

function makeService(currentBooking: object, currentPolicy = originalPolicy, quoteTtlMinutes = 15) {
  const database = {
    client: {
      booking: { findFirst: vi.fn().mockResolvedValue(currentBooking) },
      vehiclePolicyVersion: {
        findFirst: vi.fn().mockResolvedValue(currentPolicy),
        findUnique: vi.fn().mockResolvedValue(originalPolicy),
      },
    },
  };
  const availability = { occupancyConflict: vi.fn().mockResolvedValue(null) };
  const fulfillment = { evaluate: vi.fn().mockResolvedValue({ supported: true }) };
  const configuration = {
    getOrThrow: vi.fn((key: string) =>
      key === 'QUOTE_TTL_MINUTES' ? quoteTtlMinutes : 'x'.repeat(32),
    ),
  };
  return {
    availability,
    configuration,
    database,
    fulfillment,
    service: new AmendmentPreviewService(
      database as never,
      availability as never,
      fulfillment as never,
      configuration as never,
    ),
  };
}

function decodeClaims(token: string) {
  return JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8')) as {
    financial: {
      additionalPaymentMinor: string;
      currency: string;
      expectedRefundMinor: string;
      proposedEconomicTotalMinor: string;
      retainedNonRefundableRentalMinor: string;
    };
    policyDigest: string;
    proposal: {
      collectionDestination: typeof destination | null;
      deliveryDestination: typeof destination | null;
      endMethod: 'OWNER_COLLECTION' | 'RENTER_RETURN';
      rentalEnd: string;
      rentalStart: string;
      startMethod: 'OWNER_DELIVERY' | 'RENTER_PICKUP';
    };
  };
}

function appliedAmendment(input: {
  appliedAt: string;
  id: string;
  proposedChargeableDays: number;
  proposedCommissionMinor: bigint;
  proposedEnd: string;
  proposedOwnerEarningsMinor: bigint;
  proposedRentalMinor: bigint;
}) {
  return {
    appliedAt: new Date(input.appliedAt),
    fulfillmentSnapshot: null,
    id: input.id,
    pricingSnapshot: {
      currency: 'PHP',
      currentOwnerEarningsMinor: 180_000n,
      durationDiscountTier: input.proposedChargeableDays >= 7 ? 'WEEKLY_7_DAY' : 'SHORT_3_DAY',
      proposedChargeableDays: input.proposedChargeableDays,
      proposedCommissionMinor: input.proposedCommissionMinor,
      proposedOwnerEarningsMinor: input.proposedOwnerEarningsMinor,
      proposedRentalSubtotalMinor: input.proposedRentalMinor,
    },
    proposedEndMethod: 'RENTER_RETURN',
    proposedRentalEnd: new Date(input.proposedEnd),
    proposedRentalStart: booking.rentalStart,
    proposedStartMethod: 'RENTER_PICKUP',
    settlement: { proposedTotalMinor: input.proposedRentalMinor },
    status: BookingAmendmentStatus.APPLIED,
    updatedAt: new Date(input.appliedAt),
  };
}
