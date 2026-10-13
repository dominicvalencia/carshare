import {
  BookingStatus,
  FileAssetStatus,
  FileClassification,
  VehicleOperationalStatus,
} from '@carrental/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OwnerHomeService } from './owner-home.service';

const NOW = new Date('2026-10-02T04:00:00.000Z');

function booking(reference: string, status: BookingStatus, rentalStart: string, rentalEnd: string) {
  return {
    actualPickupAt: status === BookingStatus.ACTIVE ? new Date(rentalStart) : null,
    actualReturnAt: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    disputes: [],
    fulfillmentSnapshot: {
      endAddressLine1: null,
      endBarangay: null,
      endCity: 'Makati City',
      endCountry: 'PH',
      endLatitude: 14.55,
      endLongitude: 121.02,
      endMethod: 'RENTER_RETURN',
      endPostalCode: null,
      endProvince: 'Metro Manila',
      startAddressLine1: 'Ayala Avenue',
      startBarangay: null,
      startCity: 'Makati City',
      startCountry: 'PH',
      startLatitude: 14.55,
      startLongitude: 121.02,
      startMethod: 'RENTER_PICKUP',
      startPostalCode: null,
      startProvince: 'Metro Manila',
    },
    handoverEvidenceWaivers: [],
    handoverTravelEvents: [],
    handoverWorkflowVersion: null,
    id: `${reference}-id`,
    inspections: [],
    operationalHold: false,
    overdueHandoverRecoveries: [],
    pickupHandoverResponse: null,
    pickupWindowEnd: new Date(new Date(rentalStart).getTime() + 30 * 60_000),
    publicReference: reference,
    rentalEnd: new Date(rentalEnd),
    rentalIncidents: [],
    rentalStart: new Date(rentalStart),
    renter: { profile: { displayName: 'Mika Santos', firstName: 'Mika' } },
    status,
    updatedAt: new Date('2026-10-02T03:00:00.000Z'),
    vehicle: {
      make: 'Mitsubishi',
      model: 'Mirage',
      operationalStatus: VehicleOperationalStatus.AVAILABLE,
      photos: [
        {
          fileAsset: {
            classification: FileClassification.PUBLIC,
            id: `${reference}-cover`,
            status: FileAssetStatus.READY,
          },
        },
      ],
    },
  };
}

describe('Owner Home read model', () => {
  const findMany = vi.fn();
  const findFirst = vi.fn();
  const bookingCount = vi.fn();
  const amendmentCount = vi.fn();
  const amendmentFindMany = vi.fn();
  const transaction = vi.fn();
  const assertOperational = vi.fn();
  const vehicleWhere = vi.fn();
  const trustedPublicGrant = vi.fn((id: string) => ({ contentPath: `/file/${id}` }));
  const database = {
    client: {
      $transaction: transaction,
      booking: { count: bookingCount, findFirst, findMany },
      bookingAmendment: { count: amendmentCount, findMany: amendmentFindMany },
    },
  };
  const configuration = {
    getOrThrow: vi.fn((key: string) => (key === 'RETURN_CONFIRMATION_GRACE_MINUTES' ? 30 : 0)),
  };
  const service = new OwnerHomeService(
    database as never,
    { assertOperational } as never,
    { trustedPublicGrant } as never,
    { vehicleWhere } as never,
    configuration as never,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    assertOperational.mockResolvedValue(undefined);
  });

  it('projects bounded Today sections, current dates, attention, requests, and next upcoming', async () => {
    const pickup = booking(
      'PICKUP-TODAY',
      BookingStatus.CONFIRMED,
      '2026-10-02T05:00:00.000Z',
      '2026-10-03T01:00:00.000Z',
    );
    const active = booking(
      'ACTIVE-EXTENDED',
      BookingStatus.ACTIVE,
      '2026-10-01T01:00:00.000Z',
      '2026-10-05T01:00:00.000Z',
    );
    const returning = booking(
      'RETURN-TODAY',
      BookingStatus.ACTIVE,
      '2026-10-01T01:00:00.000Z',
      '2026-10-02T14:00:00.000Z',
    );
    const overdue = booking(
      'RETURN-OVERDUE',
      BookingStatus.RETURN_PENDING,
      '2026-09-30T01:00:00.000Z',
      '2026-10-02T02:00:00.000Z',
    );
    const next = booking(
      'NEXT-UPCOMING',
      BookingStatus.CONFIRMED,
      '2026-10-03T02:00:00.000Z',
      '2026-10-04T02:00:00.000Z',
    );
    findMany
      .mockResolvedValueOnce([pickup])
      .mockResolvedValueOnce([active])
      .mockResolvedValueOnce([returning])
      .mockResolvedValueOnce([overdue]);
    amendmentFindMany.mockResolvedValue([
      {
        booking: {
          publicReference: 'RECOVERY-PENDING',
          renter: { profile: { displayName: 'Ana Reyes', firstName: 'Ana' } },
          vehicle: { make: 'Honda', model: 'City' },
        },
        id: 'recovery-amendment',
        operationallyExpiredAt: new Date('2026-10-02T03:30:00.000Z'),
      },
    ]);
    bookingCount.mockResolvedValue(1);
    amendmentCount.mockResolvedValue(1);
    findFirst.mockResolvedValue(next);

    const result = await service.today('owner-a', NOW);

    expect(result.timezone).toBe('Asia/Manila');
    expect(result.today).toMatchObject({
      startInclusive: '2026-10-01T16:00:00.000Z',
      endExclusive: '2026-10-02T16:00:00.000Z',
      counts: {
        actionableRequestsCount: 2,
        activeRentalsCount: 1,
        needsAttentionCount: 2,
        pickupsTodayCount: 1,
        returnsTodayCount: 1,
      },
    });
    expect(result.today.pickups[0]).toMatchObject({
      bookingReference: 'PICKUP-TODAY',
      renterDisplayName: 'Mika Santos',
      vehicle: { make: 'Mitsubishi', model: 'Mirage' },
    });
    expect(result.today.activeRentals[0]?.return.at).toEqual(active.rentalEnd);
    expect(result.today.returns[0]?.bookingReference).toBe('RETURN-TODAY');
    expect(result.today.attention[0]).toMatchObject({
      bookingReference: 'RETURN-OVERDUE',
      renterDisplayName: 'Mika Santos',
      type: 'OVERDUE_RETURN',
      vehicleMake: 'Mitsubishi',
      vehicleModel: 'Mirage',
    });
    expect(result.today.attention[1]).toMatchObject({
      bookingReference: 'RECOVERY-PENDING',
      renterDisplayName: 'Ana Reyes',
      type: 'FINANCIAL_RECOVERY',
      vehicleMake: 'Honda',
      vehicleModel: 'City',
    });
    expect(result.today.nextUpcoming?.bookingReference).toBe('NEXT-UPCOMING');
    expect(result.requests).toEqual({
      amendmentRequestsCount: 1,
      bookingRequestsCount: 1,
      totalRequestsCount: 2,
    });
  });

  it('uses one Asia/Manila boundary and Owner-scoped lifecycle predicates', async () => {
    findMany.mockResolvedValue([]);
    amendmentFindMany.mockResolvedValue([]);
    bookingCount.mockResolvedValue(0);
    amendmentCount.mockResolvedValue(0);
    findFirst.mockResolvedValue(null);

    await service.today('owner-boundary', new Date('2026-10-01T16:00:00.000Z'));

    expect(assertOperational).toHaveBeenCalledWith('owner-boundary');
    for (const [query] of findMany.mock.calls) {
      expect(query.where.ownerUserId).toBe('owner-boundary');
      expect(query.take).toBe(20);
    }
    expect(findMany.mock.calls[0]?.[0].where.rentalStart).toEqual({
      gte: new Date('2026-10-01T16:00:00.000Z'),
      lt: new Date('2026-10-02T16:00:00.000Z'),
    });
    expect(bookingCount).toHaveBeenCalledWith({
      where: {
        AND: [{ ownerUserId: 'owner-boundary' }, { status: BookingStatus.AWAITING_OWNER }],
      },
    });
    expect(amendmentCount.mock.calls[0]?.[0].where).toMatchObject({
      booking: { ownerUserId: 'owner-boundary' },
      status: 'PENDING_OWNER',
    });
  });

  it('uses permission-specific server vehicle scope for delegated Today sections', async () => {
    findMany.mockResolvedValue([]);
    amendmentFindMany.mockResolvedValue([]);
    bookingCount.mockResolvedValue(0);
    amendmentCount.mockResolvedValue(0);
    findFirst.mockResolvedValue(null);
    vehicleWhere
      .mockReturnValueOnce({ id: { in: ['vehicle-rental'] } })
      .mockReturnValueOnce({ id: { in: ['vehicle-request'] } });
    const context = {
      permissions: ['rentals.view', 'bookings.view'],
    } as never;

    await service.todayForAccess(context, NOW);

    expect(vehicleWhere).toHaveBeenNthCalledWith(1, context, 'rentals.view');
    expect(vehicleWhere).toHaveBeenNthCalledWith(2, context, 'bookings.view');
    for (const [query] of findMany.mock.calls)
      expect(query.where.vehicle).toEqual({ id: { in: ['vehicle-rental'] } });
    expect(bookingCount.mock.calls[0]?.[0].where.AND[0]).toEqual({
      vehicle: { id: { in: ['vehicle-request'] } },
    });
  });

  it('removes overdue handover attention after a recovery report is submitted', async () => {
    const recovered = booking(
      'RECOVERY-SUBMITTED',
      BookingStatus.RETURN_PENDING,
      '2026-09-30T01:00:00.000Z',
      '2026-10-02T02:00:00.000Z',
    );
    (
      recovered.overdueHandoverRecoveries as Array<{
        acceptance: null;
        response: null;
      }>
    ).push({ acceptance: null, response: null });
    findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([recovered]);
    amendmentFindMany.mockResolvedValue([]);
    bookingCount.mockResolvedValue(0);
    amendmentCount.mockResolvedValue(0);
    findFirst.mockResolvedValue(null);

    const result = await service.today('owner-a', NOW);

    expect(result.today.attention).toEqual([]);
    expect(result.today.counts.needsAttentionCount).toBe(0);
  });

  it('returns future confirmed rentals with deterministic bounded pagination', async () => {
    const first = booking(
      'UPCOMING-1',
      BookingStatus.CONFIRMED,
      '2026-10-03T01:00:00.000Z',
      '2026-10-04T01:00:00.000Z',
    );
    const second = booking(
      'UPCOMING-2',
      BookingStatus.READY_FOR_PICKUP,
      '2026-10-03T02:00:00.000Z',
      '2026-10-04T02:00:00.000Z',
    );
    second.vehicle.photos = [];
    transaction.mockResolvedValue([4, [first, second]]);

    const result = await service.upcoming('owner-a', { page: 2, pageSize: 2 }, NOW);

    const queries = transaction.mock.calls[0]?.[0];
    const listQuery = queries[1];
    expect(listQuery).toBeDefined();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ rentalStart: 'asc' }, { id: 'asc' }],
        skip: 2,
        take: 2,
        where: {
          ownerUserId: 'owner-a',
          rentalStart: { gte: new Date('2026-10-02T16:00:00.000Z') },
          status: { in: [BookingStatus.CONFIRMED, BookingStatus.READY_FOR_PICKUP] },
        },
      }),
    );
    expect(result).toMatchObject({ page: 2, pageSize: 2, total: 4, totalPages: 2 });
    expect(result.items.map(({ bookingReference }) => bookingReference)).toEqual([
      'UPCOMING-1',
      'UPCOMING-2',
    ]);
    expect(result.items[0]?.vehicle.coverPhoto).toEqual({
      contentPath: '/file/UPCOMING-1-cover',
    });
    expect(result.items[1]?.vehicle.coverPhoto).toBeNull();
    expect(trustedPublicGrant).toHaveBeenCalledTimes(1);
  });
});
