import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@carrental/database';
import type { VehicleChangeProposalSnapshotV1 } from '@carrental/api-contracts';
import { describe, expect, it, vi } from 'vitest';
import { ApplicationException } from '../common/errors/application.exception';
import type { OwnerAccessContext } from '../security/security-context';
import { VehicleChangeProposalsService } from './vehicle-change-proposals.service';

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;
const managerContext: OwnerAccessContext = {
  capacity: 'MANAGER',
  membershipId: id('1'),
  membershipStatus: 'ACTIVE',
  ownerProfileId: id('2'),
  permissions: ['vehicles.view', 'vehicles.update_operational_fields'],
  vehicleScopeMode: 'ALL_VEHICLES',
};

function snapshot(): VehicleChangeProposalSnapshotV1 {
  return {
    schemaVersion: 1,
    vehicle: {
      categoryId: id('3'),
      color: 'White',
      description: 'Clean',
      doorCount: 4,
      fuelType: 'GASOLINE',
      make: 'Honda',
      model: 'Civic',
      modelYear: 2024,
      plateNumber: 'ABC123',
      powertrain: 'ICE',
      rentalRequirements: 'Licence',
      seatCount: 5,
      transmission: 'AUTOMATIC',
      variant: 'V',
      vin: 'VIN123',
    },
    featureIds: [id('4')],
    photos: [{ displayOrder: 0, fileAssetId: id('5'), isCover: true, perspective: 'FRONT' }],
    documents: [
      {
        definitionId: id('6'),
        documentType: 'REGISTRATION',
        expiresAt: null,
        fileAssetId: id('7'),
      },
    ],
    location: {
      addressLine1: 'Private',
      addressScopeCode: null,
      barangay: null,
      barangayCode: null,
      city: 'Manila',
      cityMunicipalityCode: null,
      country: 'PH',
      landmark: null,
      latitude: '14.5',
      longitude: '121',
      pickupAreaLabel: 'Manila',
      province: 'Metro Manila',
      provinceCode: null,
      regionCode: null,
      timezone: 'Asia/Manila',
    },
    policy: {
      availabilityPolicy: 'EVERY_DAY',
      collectionFeeMinor: null,
      currency: 'PHP',
      dailyRateMinor: 250000,
      deliveryFeeMinor: null,
      evCalculationPolicyRef: null,
      evRequiredPercentage: null,
      evReturnPolicy: null,
      evTolerancePercent: null,
      excessKilometerRateMinor: null,
      extendedTripDiscountBps: null,
      friday: true,
      fuelCalculationPolicyRef: 'PH_FUEL_DEFICIENCY_MVP_V1',
      fuelReturnPolicy: 'FULL_TO_FULL',
      fuelTolerancePercent: 5,
      fulfillmentMinimumNoticeMinutes: 120,
      fulfillmentServiceRadiusMeters: null,
      includedKilometersPerDay: null,
      maximumRentalDays: 30,
      mileagePolicy: 'UNLIMITED',
      minimumRentalDays: 1,
      monday: true,
      monthlyDiscountBps: null,
      saturday: true,
      securityDepositAmountMinor: null,
      securityDepositCurrency: null,
      securityDepositRequired: false,
      shortDurationDiscountBps: null,
      sunday: true,
      supportsOwnerCollection: false,
      supportsOwnerDelivery: false,
      supportsRenterPickup: true,
      supportsRenterReturn: true,
      thursday: true,
      turnaroundMinutes: 120,
      tuesday: true,
      wednesday: true,
      weeklyDiscountBps: null,
    },
  };
}

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    assets: [],
    baseVehicleRevision: 4,
    changeClassification: 'OWNER_APPROVAL_ONLY',
    changedFields: [],
    createdAt: new Date('2026-10-13T01:00:00Z'),
    id: id('8'),
    ownerApprovalBypassed: false,
    ownerApprovalRequired: true,
    platformReviewRequired: false,
    proposedSnapshot: snapshot(),
    snapshotSchemaVersion: 1,
    status: 'DRAFT',
    submittedMembership: { displayName: 'Manager' },
    updatedAt: new Date('2026-10-13T01:00:00Z'),
    vehicleId: id('9'),
    withdrawnAt: null,
    ...overrides,
  };
}

function setup(overrides: Record<string, unknown> = {}) {
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    auditLog: { create: vi.fn().mockResolvedValue({ id: id('10') }) },
    outboxEvent: { create: vi.fn().mockResolvedValue({ id: id('14') }) },
    ownerStaffMembership: {
      findFirst: vi.fn().mockResolvedValue({
        id: managerContext.membershipId,
        displayName: 'Manager',
        ownerApprovalBypassEnabled: false,
        permissions: [{ permissionId: id('15') }],
      }),
    },
    vehicle: {
      findFirst: vi.fn().mockResolvedValue({
        id: id('9'),
        make: 'Honda',
        model: 'Civic',
        ownerUserId: id('12'),
        revision: 4,
      }),
      update: vi.fn().mockResolvedValue({ id: id('9'), revision: 5 }),
    },
    vehicleFeatureAssignment: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    vehiclePolicyVersion: {
      create: vi.fn().mockResolvedValue({ id: id('13') }),
      findFirst: vi.fn().mockResolvedValue({ version: 2 }),
    },
    vehicleChangeProposal: {
      create: vi.fn().mockResolvedValue(proposal()),
      findFirst: vi.fn().mockResolvedValue({ ...proposal(), assets: [] }),
      update: vi
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(proposal({ ...data, updatedAt: new Date('2026-10-13T02:00:00Z') })),
        ),
    },
    fileAsset: {
      findFirst: vi.fn().mockResolvedValue({ id: id('16') }),
    },
    vehicleChangeProposalAsset: {
      findMany: vi.fn().mockResolvedValue([{ fileAssetId: id('16') }]),
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockResolvedValue({ id: id('17') }),
    },
    vehicleDocumentDefinition: {
      findFirst: vi.fn().mockResolvedValue({ code: 'REGISTRATION', id: id('18') }),
    },
    ...overrides,
  };
  const client = {
    $transaction: vi
      .fn()
      .mockImplementation((callback: (tx: unknown) => unknown) => callback(transaction)),
    ownerProfile: { findUnique: vi.fn().mockResolvedValue({ id: managerContext.ownerProfileId }) },
    vehicle: {
      findFirst: vi.fn().mockResolvedValue({
        make: 'Honda',
        model: 'Civic',
        modelYear: 2024,
        ownerProfileId: managerContext.ownerProfileId,
        revision: 4,
      }),
    },
    vehicleChangeProposal: {
      findFirst: vi.fn().mockResolvedValue(proposal()),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  const ownerAccess = {
    assertVehicleAccess: vi.fn().mockResolvedValue(undefined),
    requirePermission: vi.fn(),
  };
  const snapshots = {
    buildFromLiveVehicle: vi
      .fn()
      .mockResolvedValue({ baseVehicleRevision: 4, snapshot: snapshot() }),
  };
  const service = new VehicleChangeProposalsService(
    { client } as never,
    ownerAccess as never,
    snapshots as never,
    {
      trustedAuthorizedGrant: vi.fn().mockReturnValue({ contentPath: '/file', grant: 'g' }),
    } as never,
  );
  return { client, ownerAccess, service, snapshots, transaction };
}

describe('VehicleChangeProposalsService', () => {
  it('attaches a private Manager-owned photo to the proposal without mutating live photos', async () => {
    const fixture = setup();
    const result = await fixture.service.addPhoto(managerContext, id('11'), id('9'), id('8'), {
      displayOrder: 1,
      fileAssetId: id('16'),
      isCover: false,
      perspective: 'REAR' as never,
    });
    expect(fixture.transaction.fileAsset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          classification: 'PRIVATE',
          uploadedById: id('11'),
        }),
      }),
    );
    expect(fixture.transaction.vehicleChangeProposalAsset.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ proposalId: id('8'), kind: 'PHOTO' }),
      }),
    );
    expect(result.classification).toBe('PLATFORM_REVIEW_REQUIRED');
    expect(fixture.transaction).not.toHaveProperty('vehiclePhoto');
  });

  it('rejects attaching a file already owned by another proposal', async () => {
    const fixture = setup();
    fixture.transaction.vehicleChangeProposalAsset.findUnique.mockResolvedValue({
      proposalId: id('99'),
    });
    await expect(
      fixture.service.addPhoto(managerContext, id('11'), id('9'), id('8'), {
        displayOrder: 1,
        fileAssetId: id('16'),
        isCover: false,
        perspective: 'REAR' as never,
      }),
    ).rejects.toMatchObject({ code: 'VEHICLE_CHANGE_PROPOSAL_ASSET_INVALID' });
  });

  it('attaches a sensitive document to the proposal without creating a live version', async () => {
    const fixture = setup();
    const result = await fixture.service.addDocument(managerContext, id('11'), id('9'), id('8'), {
      definitionId: id('18'),
      fileAssetId: id('16'),
    });
    expect(fixture.transaction.fileAsset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ classification: 'SENSITIVE' }),
      }),
    );
    expect(result.classification).toBe('PLATFORM_REVIEW_REQUIRED');
    expect(fixture.transaction).not.toHaveProperty('vehicleDocument');
  });

  it.each([false, true])(
    'creates the same DRAFT for trusted=%s without touching live data',
    async () => {
      const fixture = setup();
      const result = await fixture.service.create(managerContext, id('11'), id('9'));
      expect(result.status).toBe('DRAFT');
      expect(result.changedFields).toEqual([]);
      expect(fixture.transaction.vehicleChangeProposal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            baseVehicleRevision: 4,
            submittedByMembershipId: managerContext.membershipId,
            submittedByUserId: id('11'),
          }),
        }),
      );
      expect(fixture.snapshots.buildFromLiveVehicle).toHaveBeenCalledWith(
        id('9'),
        managerContext.ownerProfileId,
        fixture.transaction,
      );
      expect(fixture.transaction.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'VEHICLE_CHANGE_PROPOSAL_CREATED',
          actorUserId: id('11'),
        }),
      });
      expect(fixture.transaction.vehicle.update).not.toHaveBeenCalled();
    },
  );

  it('maps the active-proposal uniqueness race to a safe conflict', async () => {
    const error = new Prisma.PrismaClientKnownRequestError('duplicate', {
      clientVersion: 'test',
      code: 'P2002',
    });
    const fixture = setup();
    fixture.transaction.vehicleChangeProposal.create.mockRejectedValue(error);
    await expect(fixture.service.create(managerContext, id('11'), id('9'))).rejects.toMatchObject({
      code: 'VEHICLE_CHANGE_PROPOSAL_ALREADY_ACTIVE',
      status: HttpStatus.CONFLICT,
    });
  });

  it('returns a safe creator-only read projection', async () => {
    const fixture = setup();
    const result = await fixture.service.get(managerContext, id('11'), id('9'), id('8'));
    expect(result.submitter).toEqual({ displayName: 'Manager' });
    expect(result).not.toHaveProperty('submittedByMembershipId');
    expect(result).not.toHaveProperty('ownerProfileId');
    expect(fixture.client.vehicleChangeProposal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          submittedByMembershipId: managerContext.membershipId,
          submittedByUserId: id('11'),
        }),
      }),
    );
  });

  it('recomputes changed fields, classification, and platform review on DRAFT update', async () => {
    const fixture = setup();
    const proposed = { ...snapshot(), vehicle: { ...snapshot().vehicle, modelYear: 2025 } };
    const result = await fixture.service.update(
      managerContext,
      id('11'),
      id('9'),
      id('8'),
      proposed,
    );
    expect(result.changedFields).toEqual(['vehicle.year']);
    expect(result.classification).toBe('PLATFORM_REVIEW_REQUIRED');
    expect(result.platformReviewRequired).toBe(true);
    expect(fixture.transaction.vehicleChangeProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          changedFields: ['vehicle.year'],
          platformReviewRequired: true,
        }),
      }),
    );
  });

  it('rejects Owner-only field injection inside the canonical snapshot', async () => {
    const fixture = setup();
    await expect(
      fixture.service.update(managerContext, id('11'), id('9'), id('8'), {
        ...snapshot(),
        ownerProfileId: id('12'),
      }),
    ).rejects.toMatchObject({ code: 'VEHICLE_CHANGE_PROPOSAL_SNAPSHOT_INVALID' });
    expect(fixture.client.$transaction).not.toHaveBeenCalled();
  });

  it('rejects foreign asset references and leaves live assets untouched', async () => {
    const fixture = setup();
    const proposed = {
      ...snapshot(),
      photos: [{ ...snapshot().photos[0]!, fileAssetId: id('99') }],
    };
    await expect(
      fixture.service.update(managerContext, id('11'), id('9'), id('8'), proposed),
    ).rejects.toMatchObject({ code: 'VEHICLE_CHANGE_PROPOSAL_ASSET_INVALID' });
    expect(Object.keys(fixture.transaction)).not.toEqual(
      expect.arrayContaining(['vehiclePhoto', 'vehicleDocument']),
    );
  });

  it('returns the stable stale conflict without rebasing or writing', async () => {
    const fixture = setup();
    fixture.snapshots.buildFromLiveVehicle.mockResolvedValue({
      baseVehicleRevision: 5,
      snapshot: snapshot(),
    });
    await expect(
      fixture.service.update(managerContext, id('11'), id('9'), id('8'), snapshot()),
    ).rejects.toMatchObject({ code: 'VEHICLE_CHANGE_PROPOSAL_STALE', status: HttpStatus.CONFLICT });
    expect(fixture.transaction.vehicleChangeProposal.update).not.toHaveBeenCalled();
  });

  it('withdraws rather than deleting the creator Manager draft and audits the actor', async () => {
    const fixture = setup();
    const result = await fixture.service.withdraw(managerContext, id('11'), id('9'), id('8'));
    expect(result.status).toBe('WITHDRAWN');
    expect(fixture.transaction.vehicleChangeProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'WITHDRAWN' }) }),
    );
    expect(fixture.transaction.vehicleChangeProposal).not.toHaveProperty('delete');
    expect(fixture.transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'VEHICLE_CHANGE_PROPOSAL_WITHDRAWN',
        actorUserId: id('11'),
      }),
    });
  });

  it.each(['STAFF', 'OWNER'] as const)(
    'denies %s because role alone is not proposal authority',
    async (capacity) => {
      const fixture = setup();
      await expect(
        fixture.service.create({ ...managerContext, capacity }, id('11'), id('9')),
      ).rejects.toBeInstanceOf(ApplicationException);
      expect(fixture.ownerAccess.assertVehicleAccess).not.toHaveBeenCalled();
    },
  );

  it('requires the explicit edit permission and scoped vehicle access', async () => {
    const fixture = setup();
    fixture.ownerAccess.assertVehicleAccess.mockRejectedValue(
      new ApplicationException('OWNER_ACCESS_DENIED', 'Denied', HttpStatus.FORBIDDEN),
    );
    await expect(fixture.service.create(managerContext, id('11'), id('9'))).rejects.toMatchObject({
      code: 'OWNER_ACCESS_DENIED',
    });
    expect(fixture.client.$transaction).not.toHaveBeenCalled();
  });

  it('revalidates active Manager membership inside the mutation transaction', async () => {
    const fixture = setup();
    fixture.transaction.ownerStaffMembership.findFirst.mockResolvedValue(null);
    await expect(fixture.service.create(managerContext, id('11'), id('9'))).rejects.toMatchObject({
      code: 'OWNER_ACCESS_DENIED',
    });
    expect(fixture.transaction.vehicleChangeProposal.create).not.toHaveBeenCalled();
  });

  it('revalidates selected-vehicle assignment inside the transaction', async () => {
    const fixture = setup();
    await fixture.service.create(
      { ...managerContext, vehicleScopeMode: 'SELECTED_VEHICLES' },
      id('11'),
      id('9'),
    );
    expect(fixture.transaction.vehicle.findFirst).toHaveBeenCalledWith({
      select: { id: true, make: true, model: true, ownerUserId: true },
      where: expect.objectContaining({
        staffAssignments: { some: { membershipId: managerContext.membershipId } },
      }),
    });
  });

  it('does not edit a terminal or another Manager proposal', async () => {
    const fixture = setup();
    fixture.transaction.vehicleChangeProposal.findFirst.mockResolvedValue(null);
    await expect(
      fixture.service.update(managerContext, id('11'), id('9'), id('8'), snapshot()),
    ).rejects.toMatchObject({ code: 'VEHICLE_CHANGE_PROPOSAL_NOT_EDITABLE' });
    expect(fixture.transaction.vehicleChangeProposal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['DRAFT', 'OWNER_CHANGES_REQUIRED', 'PLATFORM_CHANGES_REQUIRED'] },
          submittedByMembershipId: managerContext.membershipId,
          submittedByUserId: id('11'),
        }),
      }),
    );
    expect(fixture.transaction.vehicleChangeProposal.update).not.toHaveBeenCalled();
  });

  it('submits a normal Manager proposal to Owner approval', async () => {
    const fixture = setup();
    fixture.transaction.vehicleChangeProposal.findFirst.mockResolvedValue({
      ...proposal({
        proposedSnapshot: {
          ...snapshot(),
          vehicle: { ...snapshot().vehicle, description: 'Changed description' },
        },
      }),
      assets: [],
    });
    const result = await fixture.service.submit(managerContext, id('11'), id('9'), id('8'));
    expect(result.status).toBe('PENDING_OWNER_APPROVAL');
    expect(fixture.transaction.vehicleChangeProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerApprovalBypassed: false,
          ownerApprovalRequired: true,
          status: 'PENDING_OWNER_APPROVAL',
          trustEnabledAtSubmission: false,
        }),
      }),
    );
    expect(fixture.transaction.vehicle.update).not.toHaveBeenCalled();
    expect(fixture.transaction.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'VEHICLE_CHANGE_PROPOSAL_SUBMITTED',
        payload: expect.objectContaining({
          notificationAudience: 'OWNER',
          proposalId: id('8'),
          recipientUserId: id('12'),
          vehicleId: id('9'),
        }),
      }),
    });
  });

  it('applies a trusted Manager safe proposal and transactionally notifies the Owner', async () => {
    const fixture = setup();
    fixture.transaction.ownerStaffMembership.findFirst.mockResolvedValue({
      displayName: 'Mika Santos',
      id: managerContext.membershipId,
      ownerApprovalBypassEnabled: true,
      permissions: [{ permissionId: id('15') }],
    });
    fixture.transaction.vehicleChangeProposal.findFirst.mockResolvedValue({
      ...proposal({
        proposedSnapshot: {
          ...snapshot(),
          vehicle: { ...snapshot().vehicle, description: 'Changed description' },
        },
      }),
      assets: [],
    });
    const result = await fixture.service.submit(managerContext, id('11'), id('9'), id('8'));
    expect(result).toMatchObject({
      ownerApprovalBypassed: true,
      ownerApprovalRequired: false,
      platformReviewRequired: false,
      status: 'APPLIED',
    });
    expect(fixture.transaction.vehicle.update).toHaveBeenCalledOnce();
    expect(fixture.transaction.vehiclePolicyVersion.create).toHaveBeenCalledOnce();
    expect(fixture.transaction.vehicleFeatureAssignment.deleteMany).toHaveBeenCalledOnce();
    expect(fixture.transaction.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        aggregateId: id('8'),
        eventType: 'VEHICLE_CHANGE_PROPOSAL_TRUSTED_APPLIED',
        payload: expect.objectContaining({
          managerDisplayName: 'Mika Santos',
          recipientUserId: id('12'),
          vehicleDisplayName: 'Honda Civic',
          vehicleId: id('9'),
        }),
      }),
    });
  });

  it('sends a trusted sensitive proposal to platform review without mutating live data', async () => {
    const fixture = setup();
    fixture.transaction.ownerStaffMembership.findFirst.mockResolvedValue({
      displayName: 'Mika Santos',
      id: managerContext.membershipId,
      ownerApprovalBypassEnabled: true,
      permissions: [{ permissionId: id('15') }],
    });
    fixture.transaction.vehicleChangeProposal.findFirst.mockResolvedValue({
      ...proposal({
        proposedSnapshot: {
          ...snapshot(),
          vehicle: { ...snapshot().vehicle, modelYear: 2025 },
        },
      }),
      assets: [],
    });
    const result = await fixture.service.submit(managerContext, id('11'), id('9'), id('8'));
    expect(result).toMatchObject({
      ownerApprovalBypassed: true,
      ownerApprovalRequired: false,
      platformReviewRequired: true,
      status: 'PENDING_PLATFORM_REVIEW',
    });
    expect(fixture.transaction.vehicle.update).not.toHaveBeenCalled();
    expect(fixture.transaction.vehiclePolicyVersion.create).not.toHaveBeenCalled();
    expect(fixture.transaction.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'VEHICLE_CHANGE_PROPOSAL_TRUSTED_PLATFORM_REVIEW_SUBMITTED',
      }),
    });
  });

  it('does not let trusted state replace the exact edit permission', async () => {
    const fixture = setup();
    fixture.transaction.ownerStaffMembership.findFirst.mockResolvedValue({
      displayName: 'Manager',
      id: managerContext.membershipId,
      ownerApprovalBypassEnabled: true,
      permissions: [],
    });
    await expect(
      fixture.service.submit(managerContext, id('11'), id('9'), id('8')),
    ).rejects.toMatchObject({ code: 'OWNER_ACCESS_DENIED' });
    expect(fixture.transaction.vehicleChangeProposal.update).not.toHaveBeenCalled();
    expect(fixture.transaction.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('fails the trusted submission when the transactional Owner notification cannot be written', async () => {
    const fixture = setup();
    fixture.transaction.ownerStaffMembership.findFirst.mockResolvedValue({
      displayName: 'Mika Santos',
      id: managerContext.membershipId,
      ownerApprovalBypassEnabled: true,
      permissions: [{ permissionId: id('15') }],
    });
    fixture.transaction.vehicleChangeProposal.findFirst.mockResolvedValue({
      ...proposal({
        proposedSnapshot: {
          ...snapshot(),
          vehicle: { ...snapshot().vehicle, description: 'Changed description' },
        },
      }),
      assets: [],
    });
    fixture.transaction.outboxEvent.create.mockRejectedValue(new Error('outbox unavailable'));
    await expect(
      fixture.service.submit(managerContext, id('11'), id('9'), id('8')),
    ).rejects.toThrow('outbox unavailable');
  });

  it('rejects empty and stale submissions before changing status', async () => {
    const empty = setup();
    await expect(
      empty.service.submit(managerContext, id('11'), id('9'), id('8')),
    ).rejects.toMatchObject({
      code: 'VEHICLE_CHANGE_PROPOSAL_EMPTY',
    });
    const stale = setup();
    stale.transaction.vehicleChangeProposal.findFirst.mockResolvedValue({
      ...proposal({ baseVehicleRevision: 3 }),
      assets: [],
    });
    await expect(
      stale.service.submit(managerContext, id('11'), id('9'), id('8')),
    ).rejects.toMatchObject({
      code: 'VEHICLE_CHANGE_PROPOSAL_STALE',
    });
    expect(stale.transaction.vehicleChangeProposal.update).not.toHaveBeenCalled();
    expect(stale.transaction.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('lets the Owner return a pending proposal without touching the live vehicle', async () => {
    const fixture = setup();
    fixture.transaction.vehicle.findFirst.mockResolvedValue({
      id: id('9'),
      ownerProfileId: managerContext.ownerProfileId,
      revision: 4,
      status: 'APPROVED',
    });
    fixture.transaction.vehicleChangeProposal.findFirst.mockResolvedValue(
      proposal({
        ownerProfileId: managerContext.ownerProfileId,
        status: 'PENDING_OWNER_APPROVAL',
        submittedByMembershipId: managerContext.membershipId,
        submittedByUserId: id('11'),
      }),
    );
    const result = await fixture.service.returnForChanges(
      id('12'),
      id('9'),
      id('8'),
      'Please clarify the rental requirements.',
    );
    expect(result.status).toBe('OWNER_CHANGES_REQUIRED');
    expect(fixture.transaction.vehicleChangeProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerReviewReason: 'Please clarify the rental requirements.',
          ownerReviewedByUserId: id('12'),
          status: 'OWNER_CHANGES_REQUIRED',
        }),
      }),
    );
    expect(fixture.transaction.vehicle.update).not.toHaveBeenCalled();
  });

  it('applies a safe Owner-approved proposal atomically with one revision and policy version', async () => {
    const fixture = setup();
    fixture.transaction.vehicle.findFirst.mockResolvedValue({
      id: id('9'),
      ownerProfileId: managerContext.ownerProfileId,
      revision: 4,
      status: 'APPROVED',
    });
    fixture.transaction.vehicleChangeProposal.findFirst.mockResolvedValue(
      proposal({
        ownerProfileId: managerContext.ownerProfileId,
        proposedSnapshot: {
          ...snapshot(),
          vehicle: { ...snapshot().vehicle, description: 'New description' },
        },
        status: 'PENDING_OWNER_APPROVAL',
        submittedByMembershipId: managerContext.membershipId,
        submittedByUserId: id('11'),
      }),
    );
    const result = await fixture.service.approve(id('12'), id('9'), id('8'));
    expect(result.status).toBe('APPLIED');
    expect(fixture.transaction.vehicle.update).toHaveBeenCalledOnce();
    expect(fixture.transaction.vehicle.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revision: { increment: 1 } }) }),
    );
    expect(fixture.transaction.vehiclePolicyVersion.create).toHaveBeenCalledOnce();
    expect(fixture.transaction.vehicleFeatureAssignment.deleteMany).toHaveBeenCalledOnce();
    expect(fixture.transaction.vehicleFeatureAssignment.createMany).toHaveBeenCalledOnce();
    expect(fixture.transaction.vehicleChangeProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'APPLIED' }) }),
    );
  });

  it('moves sensitive Owner-approved proposals to platform review without any live mutation', async () => {
    const fixture = setup();
    fixture.transaction.vehicle.findFirst.mockResolvedValue({
      id: id('9'),
      ownerProfileId: managerContext.ownerProfileId,
      revision: 4,
      status: 'APPROVED',
    });
    fixture.transaction.vehicleChangeProposal.findFirst.mockResolvedValue(
      proposal({
        ownerProfileId: managerContext.ownerProfileId,
        proposedSnapshot: { ...snapshot(), vehicle: { ...snapshot().vehicle, modelYear: 2025 } },
        status: 'PENDING_OWNER_APPROVAL',
        submittedByMembershipId: managerContext.membershipId,
        submittedByUserId: id('11'),
      }),
    );
    const result = await fixture.service.approve(id('12'), id('9'), id('8'));
    expect(result.status).toBe('PENDING_PLATFORM_REVIEW');
    expect(fixture.transaction.vehicle.update).not.toHaveBeenCalled();
    expect(fixture.transaction.vehiclePolicyVersion.create).not.toHaveBeenCalled();
    expect(fixture.transaction.vehicleFeatureAssignment.deleteMany).not.toHaveBeenCalled();
    expect(fixture.transaction.vehicleChangeProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING_PLATFORM_REVIEW' }),
      }),
    );
  });

  it('allows withdrawal while pending Owner approval but not platform review', async () => {
    const pending = setup();
    pending.transaction.vehicleChangeProposal.findFirst.mockResolvedValue(
      proposal({ status: 'PENDING_OWNER_APPROVAL' }),
    );
    expect(
      (await pending.service.withdraw(managerContext, id('11'), id('9'), id('8'))).status,
    ).toBe('WITHDRAWN');
    const platform = setup();
    platform.transaction.vehicleChangeProposal.findFirst.mockResolvedValue(null);
    await expect(
      platform.service.withdraw(managerContext, id('11'), id('9'), id('8')),
    ).rejects.toMatchObject({ code: 'VEHICLE_CHANGE_PROPOSAL_NOT_EDITABLE' });
  });

  it('returns a safe Owner review comparison without internal membership identifiers', async () => {
    const fixture = setup();
    fixture.client.vehicleChangeProposal.findFirst.mockResolvedValue(
      proposal({
        proposedSnapshot: {
          ...snapshot(),
          vehicle: { ...snapshot().vehicle, description: 'Changed' },
        },
        submittedAt: new Date('2026-10-13T02:00:00Z'),
      }),
    );
    const result = await fixture.service.ownerDetail(id('12'), id('9'), id('8'));
    expect(result.comparison.changedFields).toEqual(['vehicle.description']);
    expect(result.submitter).toEqual({ displayName: 'Manager' });
    expect(result).not.toHaveProperty('submittedByMembershipId');
    expect(result).not.toHaveProperty('ownerProfileId');
  });

  it('reopens an Owner-returned proposal to DRAFT on the creator first update', async () => {
    const fixture = setup();
    fixture.transaction.vehicleChangeProposal.findFirst.mockResolvedValue({
      ...proposal({ status: 'OWNER_CHANGES_REQUIRED' }),
      assets: [],
    });
    await fixture.service.update(managerContext, id('11'), id('9'), id('8'), {
      ...snapshot(),
      vehicle: { ...snapshot().vehicle, description: 'Revised' },
    });
    expect(fixture.transaction.vehicleChangeProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DRAFT' }) }),
    );
  });

  it('lists only pending Owner proposals and derives each safe comparison', async () => {
    const fixture = setup();
    fixture.client.vehicleChangeProposal.findMany.mockResolvedValue([
      { id: id('8'), vehicleId: id('9') },
    ]);
    fixture.client.vehicleChangeProposal.findFirst.mockResolvedValue(
      proposal({
        proposedSnapshot: {
          ...snapshot(),
          vehicle: { ...snapshot().vehicle, description: 'Changed' },
        },
        submittedAt: new Date('2026-10-13T02:00:00Z'),
      }),
    );
    const result = await fixture.service.listForOwner(id('12'));
    expect(result.proposals).toHaveLength(1);
    expect(fixture.client.vehicleChangeProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['PENDING_OWNER_APPROVAL', 'PENDING_PLATFORM_REVIEW'] },
        }),
      }),
    );
  });

  it('does not mark a safe proposal applied when policy promotion fails', async () => {
    const fixture = setup();
    fixture.transaction.vehicle.findFirst.mockResolvedValue({
      id: id('9'),
      ownerProfileId: managerContext.ownerProfileId,
      revision: 4,
      status: 'APPROVED',
    });
    fixture.transaction.vehicleChangeProposal.findFirst.mockResolvedValue(
      proposal({
        ownerProfileId: managerContext.ownerProfileId,
        proposedSnapshot: {
          ...snapshot(),
          vehicle: { ...snapshot().vehicle, description: 'New description' },
        },
        status: 'PENDING_OWNER_APPROVAL',
        submittedByMembershipId: managerContext.membershipId,
        submittedByUserId: id('11'),
      }),
    );
    fixture.transaction.vehiclePolicyVersion.create.mockRejectedValue(new Error('policy failure'));
    await expect(fixture.service.approve(id('12'), id('9'), id('8'))).rejects.toThrow(
      'policy failure',
    );
    expect(fixture.transaction.vehicleChangeProposal.update).not.toHaveBeenCalled();
    expect(fixture.transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects stale Owner approval before any live mutation', async () => {
    const fixture = setup();
    fixture.transaction.vehicle.findFirst.mockResolvedValue({
      id: id('9'),
      ownerProfileId: managerContext.ownerProfileId,
      revision: 5,
      status: 'APPROVED',
    });
    fixture.transaction.vehicleChangeProposal.findFirst.mockResolvedValue(
      proposal({
        ownerProfileId: managerContext.ownerProfileId,
        status: 'PENDING_OWNER_APPROVAL',
        submittedByMembershipId: managerContext.membershipId,
        submittedByUserId: id('11'),
      }),
    );
    await expect(fixture.service.approve(id('12'), id('9'), id('8'))).rejects.toMatchObject({
      code: 'VEHICLE_CHANGE_PROPOSAL_STALE',
    });
    expect(fixture.transaction.vehicle.update).not.toHaveBeenCalled();
    expect(fixture.transaction.vehicleChangeProposal.update).not.toHaveBeenCalled();
  });
});
