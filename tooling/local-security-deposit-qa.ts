import { config } from '../packages/database/node_modules/dotenv';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import {
  type Prisma,
  type PrismaClient,
  createDatabaseClient,
} from '../packages/database/src/index';

config({ path: resolve(__dirname, '../.env') });

const OWNER_EMAIL = 'owner@demo.carrental.ph';
const RENTER_EMAIL = 'renter@demo.carrental.ph';
const FIXTURE_PREFIX = 'SECDEP-QA';
const BASE_VEHICLE_ID = '33000000-0000-4000-8000-000000000012';
const IDS = {
  noDepositVehicle: '5ecde000-0000-4000-8000-000000000001',
  requiredVehicle: '5ecde000-0000-4000-8000-000000000002',
  noDepositPolicy: '5ecde000-0000-4000-8000-000000000101',
  requiredSnapshotPolicy: '5ecde000-0000-4000-8000-000000000102',
  requiredCurrentPolicy: '5ecde000-0000-4000-8000-000000000103',
  noDepositQuote: '5ecde000-0000-4000-8000-000000000201',
  requiredQuote: '5ecde000-0000-4000-8000-000000000202',
  noDepositBooking: '5ecde000-0000-4000-8000-000000000301',
  requiredBooking: '5ecde000-0000-4000-8000-000000000302',
  noDepositOccupancy: '5ecde000-0000-4000-8000-000000000401',
  requiredOccupancy: '5ecde000-0000-4000-8000-000000000402',
  noDepositPhoto: '5ecde000-0000-4000-8000-000000000501',
  requiredPhoto: '5ecde000-0000-4000-8000-000000000502',
  noDepositPhotoAsset: '5ecde000-0000-4000-8000-000000000601',
  requiredPhotoAsset: '5ecde000-0000-4000-8000-000000000602',
} as const;

const VEHICLE_IDS = [IDS.noDepositVehicle, IDS.requiredVehicle];
const BOOKING_IDS = [IDS.noDepositBooking, IDS.requiredBooking];
const QUOTE_IDS = [IDS.noDepositQuote, IDS.requiredQuote];
const APPEND_ONLY_TRIGGERS = [
  ['booking_status_history', 'booking_status_history_append_only'],
  ['booking_pricing_snapshot_lines', 'booking_pricing_snapshot_lines_append_only'],
  ['booking_fulfillment_snapshots', 'booking_fulfillment_snapshots_append_only'],
  ['booking_policy_snapshots', 'booking_policy_snapshots_append_only'],
  ['booking_pricing_snapshots', 'booking_pricing_snapshots_append_only'],
  ['pricing_quote_lines', 'pricing_quote_lines_append_only'],
  ['pricing_quote_fulfillments', 'pricing_quote_fulfillments_append_only'],
  ['pricing_quotes', 'pricing_quotes_append_only'],
  ['vehicle_policy_versions', 'vehicle_policy_versions_append_only'],
  ['analytics_events', 'analytics_events_append_only'],
] as const;

function requireLocalDevelopment(url: string) {
  const parsed = new URL(url);
  if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
    throw new Error(`Refusing non-local database host: ${parsed.hostname}`);
  }
  if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development') {
    throw new Error(`Refusing NODE_ENV=${process.env.NODE_ENV}; development is required.`);
  }
  if (/prod(uction)?/iu.test(parsed.pathname)) {
    throw new Error(`Refusing production-like database name: ${parsed.pathname}`);
  }
}

function objectRoot() {
  const configured = process.env.OBJECT_STORAGE_ROOT ?? '.data/objects';
  return isAbsolute(configured) ? configured : resolve(__dirname, '../apps/api', configured);
}

async function copyFixtureObject(sourceKey: string, destinationKey: string) {
  const source = resolve(objectRoot(), sourceKey);
  const destination = resolve(objectRoot(), destinationKey);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await copyFile(source, destination);
}

async function deleteOwnFixtures(tx: Prisma.TransactionClient) {
  const [documents, photos] = await Promise.all([
    tx.vehicleDocument.findMany({
      where: { vehicleId: { in: VEHICLE_IDS } },
      select: { fileAssetId: true },
    }),
    tx.vehiclePhoto.findMany({
      where: { vehicleId: { in: VEHICLE_IDS } },
      select: { fileAssetId: true },
    }),
  ]);
  const fileAssetIds = [...documents, ...photos].map((file) => file.fileAssetId);
  await tx.vehicleOccupancy.deleteMany({ where: { id: { in: Object.values(IDS) } } });
  for (const [table, trigger] of APPEND_ONLY_TRIGGERS) {
    await tx.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER "${trigger}"`);
  }
  await tx.bookingStatusHistory.deleteMany({ where: { bookingId: { in: BOOKING_IDS } } });
  await tx.analyticsEvent.deleteMany({
    where: {
      OR: [
        { bookingId: { in: BOOKING_IDS } },
        { quoteId: { in: QUOTE_IDS } },
        { vehicleId: { in: VEHICLE_IDS } },
      ],
    },
  });
  await tx.bookingPricingSnapshotLine.deleteMany({ where: { bookingId: { in: BOOKING_IDS } } });
  await tx.bookingFulfillmentSnapshot.deleteMany({ where: { bookingId: { in: BOOKING_IDS } } });
  await tx.bookingPolicySnapshot.deleteMany({ where: { bookingId: { in: BOOKING_IDS } } });
  await tx.bookingPricingSnapshot.deleteMany({ where: { bookingId: { in: BOOKING_IDS } } });
  await tx.message.deleteMany({ where: { conversation: { bookingId: { in: BOOKING_IDS } } } });
  await tx.conversationParticipant.deleteMany({
    where: { conversation: { bookingId: { in: BOOKING_IDS } } },
  });
  await tx.conversation.deleteMany({ where: { bookingId: { in: BOOKING_IDS } } });
  await tx.booking.deleteMany({ where: { id: { in: BOOKING_IDS } } });
  await tx.pricingQuoteLine.deleteMany({ where: { quoteId: { in: QUOTE_IDS } } });
  await tx.pricingQuoteFulfillment.deleteMany({ where: { quoteId: { in: QUOTE_IDS } } });
  await tx.pricingQuote.deleteMany({ where: { id: { in: QUOTE_IDS } } });
  await tx.vehicleDocument.deleteMany({ where: { vehicleId: { in: VEHICLE_IDS } } });
  await tx.vehiclePhoto.deleteMany({ where: { vehicleId: { in: VEHICLE_IDS } } });
  await tx.renterRecentVehicleView.deleteMany({ where: { vehicleId: { in: VEHICLE_IDS } } });
  await tx.userFavorite.deleteMany({ where: { vehicleId: { in: VEHICLE_IDS } } });
  await tx.vehicleFeatureAssignment.deleteMany({ where: { vehicleId: { in: VEHICLE_IDS } } });
  await tx.vehicleLocation.deleteMany({ where: { vehicleId: { in: VEHICLE_IDS } } });
  await tx.vehiclePolicyVersion.deleteMany({ where: { vehicleId: { in: VEHICLE_IDS } } });
  await tx.vehicle.deleteMany({ where: { id: { in: VEHICLE_IDS } } });
  await tx.fileAsset.deleteMany({
    where: { id: { in: fileAssetIds } },
  });
  for (const [table, trigger] of APPEND_ONLY_TRIGGERS.toReversed()) {
    await tx.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER "${trigger}"`);
  }
}

async function setup(client: PrismaClient) {
  const [owner, renter, template] = await Promise.all([
    client.user.findUnique({
      where: { normalizedEmail: OWNER_EMAIL },
      include: { ownerProfile: true },
    }),
    client.user.findUnique({ where: { normalizedEmail: RENTER_EMAIL } }),
    client.vehicle.findUnique({
      where: { id: BASE_VEHICLE_ID },
      include: {
        documents: {
          where: { replacedAt: null, status: 'VERIFIED' },
          include: { fileAsset: true },
        },
        features: true,
        location: true,
        photos: {
          where: { removedAt: null },
          include: { fileAsset: true },
          orderBy: [{ isCover: 'desc' }, { displayOrder: 'asc' }],
        },
        policyVersions: { orderBy: { version: 'desc' }, take: 1 },
      },
    }),
  ]);
  if (!owner?.ownerProfile || owner.ownerProfile.status !== 'VERIFIED' || !renter || !template) {
    throw new Error('Verified demo owner, demo renter, or approved template vehicle is missing.');
  }
  if (!template.location || !template.photos[0] || !template.policyVersions[0]) {
    throw new Error('Template vehicle lacks location, cover photo, or policy data.');
  }

  await client.$transaction(async (tx) => {
    await deleteOwnFixtures(tx);
    const now = new Date('2026-10-04T04:00:00.000Z');
    const sourcePolicy = template.policyVersions[0];

    for (const [index, input] of [
      { id: IDS.noDepositVehicle, make: 'SECDEP QA', model: 'No Deposit' },
      { id: IDS.requiredVehicle, make: 'SECDEP QA', model: 'Required Deposit' },
    ].entries()) {
      await tx.vehicle.create({
        data: {
          approvedAt: now,
          categoryId: template.categoryId,
          color: template.color,
          description: `${FIXTURE_PREFIX} removable local visual-review fixture.`,
          doorCount: template.doorCount,
          fuelType: template.fuelType,
          id: input.id,
          lastCompletedSection: template.lastCompletedSection,
          make: input.make,
          model: input.model,
          modelYear: 2026,
          operationalStatus: 'AVAILABLE',
          ownerProfileId: owner.ownerProfile.id,
          ownerUserId: owner.id,
          powertrain: template.powertrain,
          rentalRequirements: template.rentalRequirements,
          seatCount: template.seatCount,
          status: 'APPROVED',
          submittedAt: now,
          transmission: template.transmission,
          variant: index === 0 ? 'Deposit optional' : 'Deposit required',
        },
      });
      await tx.vehicleLocation.create({
        data: {
          addressLine1: template.location.addressLine1,
          addressScopeCode: template.location.addressScopeCode,
          barangay: template.location.barangay,
          barangayCode: template.location.barangayCode,
          city: template.location.city,
          cityMunicipalityCode: template.location.cityMunicipalityCode,
          country: template.location.country,
          id: `5ecde000-0000-4000-8000-00000000070${index + 1}`,
          landmark: template.location.landmark,
          latitude: template.location.latitude,
          longitude: template.location.longitude,
          pickupAreaLabel: template.location.pickupAreaLabel,
          province: template.location.province,
          provinceCode: template.location.provinceCode,
          regionCode: template.location.regionCode,
          timezone: template.location.timezone,
          vehicleId: input.id,
        },
      });
      await tx.vehicleFeatureAssignment.createMany({
        data: template.features.map((feature) => ({
          featureId: feature.featureId,
          vehicleId: input.id,
        })),
      });
    }

    for (const [vehicleIndex, vehicleId] of VEHICLE_IDS.entries()) {
      for (const [photoIndex, photo] of template.photos.entries()) {
        const suffix = String(vehicleIndex * 100 + photoIndex + 1).padStart(12, '0');
        const assetId =
          photoIndex === 0
            ? vehicleIndex === 0
              ? IDS.noDepositPhotoAsset
              : IDS.requiredPhotoAsset
            : `5ecde300-0000-4000-8000-${suffix}`;
        const photoId =
          photoIndex === 0
            ? vehicleIndex === 0
              ? IDS.noDepositPhoto
              : IDS.requiredPhoto
            : `5ecde400-0000-4000-8000-${suffix}`;
        const objectKey = `${owner.id}/${assetId}`;
        await copyFixtureObject(photo.fileAsset.objectKey, objectKey);
        await tx.fileAsset.create({
          data: {
            checksum: photo.fileAsset.checksum,
            classification: photo.fileAsset.classification,
            id: assetId,
            mimeType: photo.fileAsset.mimeType,
            objectKey,
            originalName: photo.fileAsset.originalName,
            size: photo.fileAsset.size,
            status: photo.fileAsset.status,
            uploadedById: owner.id,
          },
        });
        await tx.vehiclePhoto.create({
          data: {
            displayOrder: photo.displayOrder,
            fileAssetId: assetId,
            id: photoId,
            isCover: photo.isCover,
            perspective: photo.perspective,
            vehicleId,
          },
        });
      }
    }

    for (const [vehicleIndex, vehicleId] of VEHICLE_IDS.entries()) {
      for (const [documentIndex, document] of template.documents.entries()) {
        const suffix = String(vehicleIndex * 100 + documentIndex + 1).padStart(12, '0');
        const assetId = `5ecde100-0000-4000-8000-${suffix}`;
        const objectKey = `${owner.id}/${assetId}`;
        await copyFixtureObject(document.fileAsset.objectKey, objectKey);
        await tx.fileAsset.create({
          data: {
            checksum: document.fileAsset.checksum,
            classification: document.fileAsset.classification,
            id: assetId,
            mimeType: document.fileAsset.mimeType,
            objectKey,
            originalName: document.fileAsset.originalName,
            size: document.fileAsset.size,
            status: document.fileAsset.status,
            uploadedById: owner.id,
          },
        });
        await tx.vehicleDocument.create({
          data: {
            definitionId: document.definitionId,
            expiresAt: document.expiresAt,
            fileAssetId: assetId,
            id: `5ecde200-0000-4000-8000-${suffix}`,
            reviewedAt: now,
            reviewedByUserId: document.reviewedByUserId,
            status: 'VERIFIED',
            vehicleId,
            version: 1,
          },
        });
      }
    }

    const policyBase = {
      availabilityPolicy: sourcePolicy.availabilityPolicy,
      collectionFeeMinor: sourcePolicy.collectionFeeMinor,
      createdByUserId: owner.id,
      currency: 'PHP',
      dailyRateMinor: 250_000,
      deliveryFeeMinor: sourcePolicy.deliveryFeeMinor,
      evCalculationPolicyRef: sourcePolicy.evCalculationPolicyRef,
      evRequiredPercentage: sourcePolicy.evRequiredPercentage,
      evReturnPolicy: sourcePolicy.evReturnPolicy,
      evTolerancePercent: sourcePolicy.evTolerancePercent,
      excessKilometerRateMinor: sourcePolicy.excessKilometerRateMinor,
      extendedTripDiscountBps: sourcePolicy.extendedTripDiscountBps,
      friday: sourcePolicy.friday,
      fuelCalculationPolicyRef: sourcePolicy.fuelCalculationPolicyRef,
      fuelReturnPolicy: sourcePolicy.fuelReturnPolicy,
      fuelTolerancePercent: sourcePolicy.fuelTolerancePercent,
      fulfillmentMinimumNoticeMinutes: sourcePolicy.fulfillmentMinimumNoticeMinutes,
      fulfillmentServiceRadiusMeters: sourcePolicy.fulfillmentServiceRadiusMeters,
      includedKilometersPerDay: sourcePolicy.includedKilometersPerDay,
      maximumRentalDays: sourcePolicy.maximumRentalDays,
      mileagePolicy: sourcePolicy.mileagePolicy,
      minimumRentalDays: sourcePolicy.minimumRentalDays,
      monday: sourcePolicy.monday,
      monthlyDiscountBps: sourcePolicy.monthlyDiscountBps,
      saturday: sourcePolicy.saturday,
      shortDurationDiscountBps: sourcePolicy.shortDurationDiscountBps,
      sunday: sourcePolicy.sunday,
      supportsOwnerCollection: sourcePolicy.supportsOwnerCollection,
      supportsOwnerDelivery: sourcePolicy.supportsOwnerDelivery,
      supportsRenterPickup: true,
      supportsRenterReturn: true,
      thursday: sourcePolicy.thursday,
      turnaroundMinutes: sourcePolicy.turnaroundMinutes,
      tuesday: sourcePolicy.tuesday,
      weeklyDiscountBps: sourcePolicy.weeklyDiscountBps,
      wednesday: sourcePolicy.wednesday,
    };
    await tx.vehiclePolicyVersion.createMany({
      data: [
        {
          ...policyBase,
          id: IDS.noDepositPolicy,
          securityDepositAmountMinor: null,
          securityDepositCurrency: null,
          securityDepositRequired: false,
          vehicleId: IDS.noDepositVehicle,
          version: 1,
        },
        {
          ...policyBase,
          id: IDS.requiredSnapshotPolicy,
          securityDepositAmountMinor: 500_000,
          securityDepositCurrency: 'PHP',
          securityDepositRequired: true,
          vehicleId: IDS.requiredVehicle,
          version: 1,
        },
        {
          ...policyBase,
          id: IDS.requiredCurrentPolicy,
          securityDepositAmountMinor: 1_000_000,
          securityDepositCurrency: 'PHP',
          securityDepositRequired: true,
          vehicleId: IDS.requiredVehicle,
          version: 2,
        },
      ],
    });

    const scenarios = [
      {
        bookingId: IDS.noDepositBooking,
        occupancyId: IDS.noDepositOccupancy,
        policyId: IDS.noDepositPolicy,
        publicReference: 'SECDEP-QA-NODEPOSIT',
        quoteId: IDS.noDepositQuote,
        required: false,
        start: new Date('2026-10-15T01:00:00.000Z'),
        end: new Date('2026-10-17T01:00:00.000Z'),
        vehicleId: IDS.noDepositVehicle,
      },
      {
        bookingId: IDS.requiredBooking,
        occupancyId: IDS.requiredOccupancy,
        policyId: IDS.requiredSnapshotPolicy,
        publicReference: 'SECDEP-QA-REQUIRED',
        quoteId: IDS.requiredQuote,
        required: true,
        start: new Date('2026-10-20T01:00:00.000Z'),
        end: new Date('2026-10-22T01:00:00.000Z'),
        vehicleId: IDS.requiredVehicle,
      },
    ];
    for (const scenario of scenarios) {
      await tx.pricingQuote.create({
        data: {
          baseRentalAmountMinor: 500_000,
          chargeableDays: 2,
          currency: 'PHP',
          discountedRentalSubtotalMinor: 500_000,
          excessKilometerRateMinor: sourcePolicy.excessKilometerRateMinor,
          expiresAt: new Date('2026-12-31T15:59:59.000Z'),
          id: scenario.quoteId,
          includedMileageKm: sourcePolicy.includedKilometersPerDay
            ? sourcePolicy.includedKilometersPerDay * 2
            : null,
          policyVersionId: scenario.policyId,
          pricingEngineVersion: 'SECDEP_QA_V1',
          rentalEnd: scenario.end,
          rentalStart: scenario.start,
          renterUserId: renter.id,
          subtotalMinor: 500_000,
          totalMinor: 500_000,
          turnaroundMinutes: sourcePolicy.turnaroundMinutes,
          unlimitedMileage: sourcePolicy.mileagePolicy === 'UNLIMITED',
          vehicleId: scenario.vehicleId,
          vehicleTimezone: template.location.timezone,
        },
      });
      await tx.pricingQuoteLine.create({
        data: {
          amountMinor: 500_000,
          code: 'BASE_RENTAL',
          description: '2 rental days',
          displayOrder: 0,
          id: scenario.quoteId.replace('000201', '000801').replace('000202', '000802'),
          quantity: 2,
          quoteId: scenario.quoteId,
          unitAmountMinor: 250_000,
        },
      });
      const fulfillment = {
        currency: 'PHP',
        endAddressLine1: template.location.addressLine1,
        endBarangay: template.location.barangay,
        endCity: template.location.city,
        endCountry: template.location.country,
        endLatitude: template.location.latitude,
        endLongitude: template.location.longitude,
        endMethod: 'RENTER_RETURN' as const,
        endPostalCode: null,
        endProvince: template.location.province,
        minimumNoticeMinutes: sourcePolicy.fulfillmentMinimumNoticeMinutes,
        sourcePolicyVersionId: scenario.policyId,
        startAddressLine1: template.location.addressLine1,
        startBarangay: template.location.barangay,
        startCity: template.location.city,
        startCountry: template.location.country,
        startLatitude: template.location.latitude,
        startLongitude: template.location.longitude,
        startMethod: 'RENTER_PICKUP' as const,
        startPostalCode: null,
        startProvince: template.location.province,
      };
      await tx.pricingQuoteFulfillment.create({
        data: { ...fulfillment, quoteId: scenario.quoteId },
      });
      await tx.booking.create({
        data: {
          id: scenario.bookingId,
          ownerProfileId: owner.ownerProfile.id,
          ownerResponseDeadlineAt: new Date('2026-12-31T15:59:59.000Z'),
          ownerUserId: owner.id,
          publicReference: scenario.publicReference,
          quoteId: scenario.quoteId,
          rentalEnd: scenario.end,
          rentalStart: scenario.start,
          renterUserId: renter.id,
          status: 'AWAITING_OWNER',
          vehicleId: scenario.vehicleId,
        },
      });
      await tx.bookingPricingSnapshot.create({
        data: {
          baseRentalAmountMinor: 500_000,
          bookingId: scenario.bookingId,
          chargeableDays: 2,
          currency: 'PHP',
          discountedRentalSubtotalMinor: 500_000,
          excessKilometerRateMinor: sourcePolicy.excessKilometerRateMinor,
          includedMileageKm: sourcePolicy.includedKilometersPerDay
            ? sourcePolicy.includedKilometersPerDay * 2
            : null,
          policyVersionId: scenario.policyId,
          pricingEngineVersion: 'SECDEP_QA_V1',
          quoteId: scenario.quoteId,
          rentalEnd: scenario.end,
          rentalStart: scenario.start,
          subtotalMinor: 500_000,
          totalMinor: 500_000,
          unlimitedMileage: sourcePolicy.mileagePolicy === 'UNLIMITED',
          vehicleTimezone: template.location.timezone,
        },
      });
      await tx.bookingPricingSnapshotLine.create({
        data: {
          amountMinor: 500_000,
          bookingId: scenario.bookingId,
          code: 'BASE_RENTAL',
          description: '2 rental days',
          displayOrder: 0,
          id: scenario.bookingId.replace('000301', '000901').replace('000302', '000902'),
          quantity: 2,
          unitAmountMinor: 250_000,
        },
      });
      await tx.bookingPolicySnapshot.create({
        data: {
          availabilityPolicy: sourcePolicy.availabilityPolicy,
          bookingId: scenario.bookingId,
          evCalculationPolicyRef: sourcePolicy.evCalculationPolicyRef,
          evRequiredPercentage: sourcePolicy.evRequiredPercentage,
          evReturnPolicy: sourcePolicy.evReturnPolicy,
          evTolerancePercent: sourcePolicy.evTolerancePercent,
          excessKilometerRateMinor: sourcePolicy.excessKilometerRateMinor,
          friday: sourcePolicy.friday,
          fuelCalculationPolicyRef: sourcePolicy.fuelCalculationPolicyRef,
          fuelReturnPolicy: sourcePolicy.fuelReturnPolicy,
          fuelTolerancePercent: sourcePolicy.fuelTolerancePercent,
          includedKilometersPerDay: sourcePolicy.includedKilometersPerDay,
          mileagePolicy: sourcePolicy.mileagePolicy,
          monday: sourcePolicy.monday,
          policyVersionId: scenario.policyId,
          saturday: sourcePolicy.saturday,
          securityDepositAmountMinor: scenario.required ? 500_000 : null,
          securityDepositCurrency: scenario.required ? 'PHP' : null,
          securityDepositRequired: scenario.required,
          sunday: sourcePolicy.sunday,
          thursday: sourcePolicy.thursday,
          turnaroundMinutes: sourcePolicy.turnaroundMinutes,
          tuesday: sourcePolicy.tuesday,
          wednesday: sourcePolicy.wednesday,
        },
      });
      await tx.bookingFulfillmentSnapshot.create({
        data: { ...fulfillment, bookingId: scenario.bookingId },
      });
      await tx.bookingStatusHistory.create({
        data: {
          actorType: 'USER',
          actorUserId: renter.id,
          bookingId: scenario.bookingId,
          correlationId: `${FIXTURE_PREFIX}-${scenario.publicReference}`,
          fromStatus: 'AWAITING_PAYMENT',
          reasonCode: 'OWNER_REQUESTED',
          toStatus: 'AWAITING_OWNER',
        },
      });
      await tx.vehicleOccupancy.create({
        data: {
          active: true,
          bookingId: scenario.bookingId,
          expiresAt: new Date('2026-12-31T15:59:59.000Z'),
          id: scenario.occupancyId,
          occupiedEnd: scenario.end,
          occupiedStart: scenario.start,
          type: 'BOOKING_RESERVATION',
          vehicleId: scenario.vehicleId,
        },
      });
    }
  });

  console.log('Security Deposit QA fixtures created/repaired.');
  await audit(client);
}

async function audit(client: PrismaClient) {
  const [owner, renter, vehicles, bookings, financialCounts, locations] = await Promise.all([
    client.user.findUnique({ where: { normalizedEmail: OWNER_EMAIL } }),
    client.user.findUnique({ where: { normalizedEmail: RENTER_EMAIL } }),
    client.vehicle.findMany({
      where: { id: { in: VEHICLE_IDS } },
      include: { policyVersions: { orderBy: { version: 'asc' } } },
      orderBy: { id: 'asc' },
    }),
    client.booking.findMany({
      where: { id: { in: BOOKING_IDS } },
      include: { policySnapshot: true, pricingSnapshot: true, securityDeposit: true },
      orderBy: { publicReference: 'asc' },
    }),
    Promise.all([
      client.payment.count({ where: { bookingId: { in: BOOKING_IDS } } }),
      client.securityDepositAuthorization.count({ where: { bookingId: { in: BOOKING_IDS } } }),
      client.commissionSnapshot.count({ where: { bookingId: { in: BOOKING_IDS } } }),
      client.ownerEarning.count({ where: { bookingId: { in: BOOKING_IDS } } }),
    ]),
    client.$queryRawUnsafe<
      Array<{ distanceKm: number | null; pointPresent: boolean; vehicleId: string }>
    >(
      `SELECT "vehicle_id" AS "vehicleId", "point" IS NOT NULL AS "pointPresent",
        (ST_Distance("point", ST_SetSRID(ST_MakePoint(123.8983, 10.3223), 4326)::geography) / 1000.0)::double precision AS "distanceKm"
       FROM "vehicle_locations" WHERE "vehicle_id" = ANY($1::uuid[])`,
      VEHICLE_IDS,
    ),
  ]);
  console.log(
    JSON.stringify(
      {
        bookings: bookings.map((booking) => ({
          depositAuthorization: booking.securityDeposit,
          id: booking.id,
          policySnapshot: booking.policySnapshot
            ? {
                amountMinor: booking.policySnapshot.securityDepositAmountMinor,
                currency: booking.policySnapshot.securityDepositCurrency,
                required: booking.policySnapshot.securityDepositRequired,
              }
            : null,
          reference: booking.publicReference,
          rentalTotalMinor: booking.pricingSnapshot?.totalMinor,
          status: booking.status,
        })),
        executionAvailable: false,
        financialIsolation: {
          commissionSnapshots: financialCounts[2],
          ownerEarnings: financialCounts[3],
          payments: financialCounts[0],
          securityDepositAuthorizations: financialCounts[1],
        },
        owner: { email: owner?.normalizedEmail, id: owner?.id },
        renter: { email: renter?.normalizedEmail, id: renter?.id },
        locations,
        vehicles: vehicles.map((vehicle) => ({
          id: vehicle.id,
          name: `${vehicle.make} ${vehicle.model}`,
          policies: vehicle.policyVersions.map((policy) => ({
            amountMinor: policy.securityDepositAmountMinor,
            currency: policy.securityDepositCurrency,
            required: policy.securityDepositRequired,
            version: policy.version,
          })),
          status: vehicle.status,
        })),
      },
      null,
      2,
    ),
  );
}

async function cleanup(client: PrismaClient, dryRun: boolean) {
  const [documents, photos] = await Promise.all([
    client.vehicleDocument.findMany({
      where: { vehicleId: { in: VEHICLE_IDS } },
      select: { fileAsset: { select: { objectKey: true } } },
    }),
    client.vehiclePhoto.findMany({
      where: { vehicleId: { in: VEHICLE_IDS } },
      select: { fileAsset: { select: { objectKey: true } } },
    }),
  ]);
  const files = [...documents, ...photos].map((file) => file.fileAsset);
  const counts = {
    bookings: await client.booking.count({ where: { id: { in: BOOKING_IDS } } }),
    files: files.length,
    quotes: await client.pricingQuote.count({ where: { id: { in: QUOTE_IDS } } }),
    vehicles: await client.vehicle.count({ where: { id: { in: VEHICLE_IDS } } }),
  };
  console.log(`${dryRun ? 'Would remove' : 'Removing'} ${JSON.stringify(counts)}.`);
  if (dryRun) return;
  await client.$transaction(deleteOwnFixtures);
  await Promise.all(
    files.map((file) => rm(resolve(objectRoot(), file.objectKey), { force: true })),
  );
  console.log('Security Deposit QA fixtures removed.');
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  requireLocalDevelopment(databaseUrl);
  const command = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!['setup', 'audit', 'cleanup'].includes(command ?? '')) {
    throw new Error('Usage: local-security-deposit-qa.ts <setup|audit|cleanup> [--dry-run]');
  }
  const client = createDatabaseClient(databaseUrl);
  try {
    if (command === 'setup') await setup(client);
    if (command === 'audit') await audit(client);
    if (command === 'cleanup') await cleanup(client, dryRun);
  } finally {
    await client.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
