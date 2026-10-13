import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AdminVehicleChangeProposalsService } from './admin-vehicle-change-proposals.service';

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

function snapshot(make: string) {
  return {
    schemaVersion: 1,
    vehicle: {
      categoryId: null,
      color: null,
      description: null,
      doorCount: null,
      fuelType: null,
      make,
      model: 'Civic',
      modelYear: 2024,
      plateNumber: null,
      powertrain: null,
      rentalRequirements: null,
      seatCount: null,
      transmission: null,
      variant: null,
      vin: null,
    },
    featureIds: [],
    photos: [],
    documents: [],
    location: null,
    policy: { currency: 'PHP', dailyRateMinor: 250000 },
  };
}

function setup(revision = 4) {
  const proposal = {
    assets: [],
    baseVehicleRevision: 4,
    changedFields: ['vehicle.make'],
    id: id('1'),
    ownerApprovalBypassed: false,
    ownerApprovalRequired: true,
    ownerProfile: { userId: id('2') },
    ownerProfileId: id('3'),
    platformReviewRequired: true,
    proposedSnapshot: snapshot('Toyota'),
    status: 'PENDING_PLATFORM_REVIEW',
    submittedByMembershipId: id('4'),
    submittedByUserId: id('5'),
    submittedMembership: { displayName: 'Manager' },
    vehicleId: id('6'),
  };
  const vehicle = {
    id: id('6'),
    make: 'Honda',
    model: 'Civic',
    ownerProfileId: id('3'),
    ownerUserId: id('2'),
    revision,
    status: 'APPROVED',
  };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    adminUser: { findFirst: vi.fn().mockResolvedValue({ id: id('7') }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    fileAsset: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    outboxEvent: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
    vehicle: {
      findFirst: vi.fn().mockResolvedValue(vehicle),
      update: vi.fn().mockResolvedValue({}),
    },
    vehicleCategory: { count: vi.fn().mockResolvedValue(1) },
    vehicleChangeProposal: {
      findUnique: vi.fn().mockResolvedValue({ vehicleId: id('6') }),
      findFirst: vi.fn().mockResolvedValue(proposal),
      update: vi.fn().mockResolvedValue({}),
    },
    vehicleDocument: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    vehicleDocumentDefinition: { count: vi.fn().mockResolvedValue(0) },
    vehicleFeature: { count: vi.fn().mockResolvedValue(0) },
    vehicleFeatureAssignment: {
      createMany: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    vehicleLocation: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), upsert: vi.fn() },
    vehiclePhoto: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    vehiclePolicyVersion: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue({ version: 2 }),
    },
  };
  const client = { $transaction: vi.fn((callback) => callback(tx)) };
  const snapshots = {
    buildFromLiveVehicle: vi
      .fn()
      .mockResolvedValue({ baseVehicleRevision: revision, snapshot: snapshot('Honda') }),
  };
  const service = new AdminVehicleChangeProposalsService(
    { client } as never,
    snapshots as never,
    { trustedAuthorizedGrant: vi.fn() } as never,
    { hashIdentifier: vi.fn((value) => `hash:${value}`) } as never,
  );
  vi.spyOn(service as never, 'validateSnapshot').mockReturnValue(snapshot('Toyota'));
  vi.spyOn(service as never, 'validateReferences').mockResolvedValue(undefined);
  return { proposal, service, tx };
}

describe('AdminVehicleChangeProposalsService', () => {
  it('locks the live vehicle before the proposal to match every proposal mutation path', async () => {
    const { service, tx } = setup();
    await service.approve(id('1'), id('7'), id('8'));
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw.mock.calls[0]?.[0].join('')).toContain('vehicles');
    expect(tx.$queryRaw.mock.calls[1]?.[0].join('')).toContain('vehicle_change_proposals');
  });

  it('atomically promotes an approved proposal without changing live lifecycle state', async () => {
    const { service, tx } = setup();
    const result = await service.approve(id('1'), id('7'), id('8'));
    expect(result).toMatchObject({ resultingVehicleRevision: 5, status: 'APPLIED' });
    expect(tx.vehicle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ make: 'Toyota', revision: { increment: 1 } }),
      }),
    );
    expect(tx.vehicle.update.mock.calls[0]?.[0].data).not.toHaveProperty('status');
    expect(tx.vehiclePolicyVersion.create).toHaveBeenCalledTimes(1);
    expect(tx.vehicleChangeProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'APPLIED' }),
      }),
    );
    expect(tx.outboxEvent.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ eventType: 'VEHICLE_CHANGE_PROPOSAL_PLATFORM_APPROVED' }),
      ]),
    });
    expect(tx.outboxEvent.createMany.mock.calls[0]?.[0].data).toHaveLength(2);
  });

  it('rejects stale approval before mutating the live aggregate', async () => {
    const { service, tx } = setup(5);
    await expect(service.approve(id('1'), id('7'), id('8'))).rejects.toMatchObject({
      code: 'VEHICLE_CHANGE_PROPOSAL_STALE',
      status: HttpStatus.CONFLICT,
    });
    expect(tx.vehicle.update).not.toHaveBeenCalled();
    expect(tx.vehiclePolicyVersion.create).not.toHaveBeenCalled();
    expect(tx.outboxEvent.createMany).not.toHaveBeenCalled();
  });

  it.each([
    ['requestChanges', 'PLATFORM_CHANGES_REQUIRED'],
    ['reject', 'REJECTED'],
  ] as const)('%s leaves the approved live vehicle unchanged', async (method, status) => {
    const { service, tx } = setup();
    const result = await service[method](
      id('1'),
      'A sufficiently clear review reason',
      id('7'),
      id('8'),
    );
    expect(result.status).toBe(status);
    expect(tx.vehicle.update).not.toHaveBeenCalled();
    expect(tx.vehiclePolicyVersion.create).not.toHaveBeenCalled();
    expect(tx.vehicleChangeProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status }) }),
    );
  });

  it('allows a stale proposal to be returned for changes without mutating the live vehicle', async () => {
    const { service, tx } = setup(5);
    const result = await service.requestChanges(
      id('1'),
      'Rebase this proposal on the current live vehicle.',
      id('7'),
      id('8'),
    );
    expect(result).toMatchObject({
      resultingVehicleRevision: 5,
      status: 'PLATFORM_CHANGES_REQUIRED',
    });
    expect(tx.vehicle.update).not.toHaveBeenCalled();
  });
});
