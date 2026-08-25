import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { hash } from 'argon2';
import {
  AvailabilityPolicyType,
  EvReturnPolicyType,
  FileAssetStatus,
  FileClassification,
  FuelReturnPolicyType,
  MileagePolicyType,
  OwnerProfileStatus,
  ReviewType,
  RoleCode,
  VehicleFuelType,
  VehicleLifecycleStatus,
  VehicleOperationalStatus,
  VehiclePhotoPerspective,
  VehiclePowertrain,
  VehicleTransmission,
  VerificationStatus,
} from '../src/generated/prisma/enums';
import type { PrismaClient } from '../src/generated/prisma/client';

const demoVehicles = [
  {
    make: 'Toyota',
    model: 'Fortuner',
    year: 2024,
    category: 'SUV',
    transmission: VehicleTransmission.AUTOMATIC,
    powertrain: VehiclePowertrain.ICE,
    fuel: VehicleFuelType.DIESEL,
    seats: 7,
    city: 'Makati City',
    province: 'Metro Manila',
    latitude: '14.5547',
    longitude: '121.0244',
    daily: 3_200_00,
    mileage: 150,
    excess: 18_00,
    description:
      'A spacious seven-seat SUV for family trips, business travel, and weekends out of town.',
    features: ['AIR_CONDITIONING', 'APPLE_CARPLAY', 'BACKUP_CAMERA', 'TOLL_RFID'],
  },
  {
    make: 'Toyota',
    model: 'Vios',
    year: 2023,
    category: 'SEDAN',
    transmission: VehicleTransmission.CVT,
    powertrain: VehiclePowertrain.ICE,
    fuel: VehicleFuelType.GASOLINE,
    seats: 5,
    city: 'Quezon City',
    province: 'Metro Manila',
    latitude: '14.6760',
    longitude: '121.0437',
    daily: 1_800_00,
    mileage: null,
    excess: null,
    description:
      'An easy-to-drive, fuel-efficient sedan for errands, meetings, and everyday city travel.',
    features: ['AIR_CONDITIONING', 'BLUETOOTH', 'USB_CHARGING', 'TOLL_RFID'],
  },
  {
    make: 'Toyota',
    model: 'Innova',
    year: 2024,
    category: 'MPV',
    transmission: VehicleTransmission.AUTOMATIC,
    powertrain: VehiclePowertrain.ICE,
    fuel: VehicleFuelType.DIESEL,
    seats: 8,
    city: 'Cebu City',
    province: 'Cebu',
    latitude: '10.3157',
    longitude: '123.8854',
    daily: 2_800_00,
    mileage: 180,
    excess: 16_00,
    description:
      'Comfortable seating and luggage room for airport pickups, family visits, and island road trips.',
    features: ['AIR_CONDITIONING', 'ANDROID_AUTO', 'BACKUP_CAMERA', 'USB_CHARGING'],
  },
  {
    make: 'Mitsubishi',
    model: 'Montero Sport',
    year: 2023,
    category: 'SUV',
    transmission: VehicleTransmission.AUTOMATIC,
    powertrain: VehiclePowertrain.ICE,
    fuel: VehicleFuelType.DIESEL,
    seats: 7,
    city: 'Davao City',
    province: 'Davao del Sur',
    latitude: '7.1907',
    longitude: '125.4553',
    daily: 3_300_00,
    mileage: 150,
    excess: 20_00,
    description: 'A refined SUV with generous space for longer drives around Davao and Mindanao.',
    features: ['AIR_CONDITIONING', 'CAMERA_360', 'CRUISE_CONTROL', 'PARKING_SENSORS'],
  },
  {
    make: 'Mitsubishi',
    model: 'Mirage',
    year: 2022,
    category: 'HATCHBACK',
    transmission: VehicleTransmission.CVT,
    powertrain: VehiclePowertrain.ICE,
    fuel: VehicleFuelType.GASOLINE,
    seats: 5,
    city: 'Iloilo City',
    province: 'Iloilo',
    latitude: '10.7202',
    longitude: '122.5621',
    daily: 1_500_00,
    mileage: 120,
    excess: 12_00,
    description:
      'A compact and economical hatchback that is simple to park and ideal for city exploring.',
    features: ['AIR_CONDITIONING', 'BLUETOOTH', 'USB_CHARGING'],
  },
  {
    make: 'Honda',
    model: 'City',
    year: 2024,
    category: 'SEDAN',
    transmission: VehicleTransmission.CVT,
    powertrain: VehiclePowertrain.ICE,
    fuel: VehicleFuelType.GASOLINE,
    seats: 5,
    city: 'Makati City',
    province: 'Metro Manila',
    latitude: '14.5547',
    longitude: '121.0244',
    daily: 2_100_00,
    mileage: 150,
    excess: 15_00,
    description:
      'A polished sedan with a comfortable cabin for city appointments and weekend drives.',
    features: ['AIR_CONDITIONING', 'APPLE_CARPLAY', 'BACKUP_CAMERA', 'KEYLESS_ENTRY'],
  },
  {
    make: 'Honda',
    model: 'BR-V',
    year: 2023,
    category: 'SUV',
    transmission: VehicleTransmission.CVT,
    powertrain: VehiclePowertrain.ICE,
    fuel: VehicleFuelType.GASOLINE,
    seats: 7,
    city: 'Cebu City',
    province: 'Cebu',
    latitude: '10.3157',
    longitude: '123.8854',
    daily: 2_700_00,
    mileage: 160,
    excess: 16_00,
    description:
      'A flexible seven-seater with the maneuverability of a city car and space for the whole group.',
    features: ['AIR_CONDITIONING', 'ANDROID_AUTO', 'BACKUP_CAMERA', 'CHILD_SEAT_COMPATIBLE'],
  },
  {
    make: 'Nissan',
    model: 'Leaf',
    year: 2022,
    category: 'HATCHBACK',
    transmission: VehicleTransmission.AUTOMATIC,
    powertrain: VehiclePowertrain.BATTERY_ELECTRIC,
    fuel: VehicleFuelType.ELECTRIC,
    seats: 5,
    city: 'Baguio City',
    province: 'Benguet',
    latitude: '16.4023',
    longitude: '120.5960',
    daily: 2_400_00,
    mileage: 140,
    excess: 15_00,
    description:
      'A quiet all-electric hatchback for relaxed city driving, with clear battery return requirements.',
    features: ['AIR_CONDITIONING', 'APPLE_CARPLAY', 'BACKUP_CAMERA', 'KEYLESS_ENTRY'],
  },
] as const;

function stableId(prefix: string, value: number): string {
  return `${prefix}000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;
}

export async function seedDevelopmentDemo(client: PrismaClient): Promise<void> {
  if (process.env.APP_ENV === 'test' || process.env.SEED_DEMO_DATA === 'false') return;
  const renterRole = await client.role.findUniqueOrThrow({ where: { code: RoleCode.RENTER } });
  const ownerRole = await client.role.findUniqueOrThrow({ where: { code: RoleCode.OWNER } });
  const passwordHash = await hash('CarRentalDemo2026!', {
    memoryCost: 19_456,
    parallelism: 1,
    timeCost: 2,
    type: 2,
  });
  const renter = await client.user.upsert({
    where: { normalizedEmail: 'renter@demo.carrental.ph' },
    create: {
      id: stableId('10', 1),
      email: 'renter@demo.carrental.ph',
      normalizedEmail: 'renter@demo.carrental.ph',
      emailVerifiedAt: new Date(),
      passwordHash,
      profile: { create: { displayName: 'Mika Santos', firstName: 'Mika', lastName: 'Santos' } },
    },
    update: { emailVerifiedAt: new Date(), passwordHash },
  });
  await client.userRole.upsert({
    where: { userId_roleId: { userId: renter.id, roleId: renterRole.id } },
    create: { userId: renter.id, roleId: renterRole.id },
    update: {},
  });
  const ownerUser = await client.user.upsert({
    where: { normalizedEmail: 'owner@demo.carrental.ph' },
    create: {
      id: stableId('10', 2),
      email: 'owner@demo.carrental.ph',
      normalizedEmail: 'owner@demo.carrental.ph',
      emailVerifiedAt: new Date(),
      mobileNumber: '+639171234567',
      mobileVerifiedAt: new Date(),
      passwordHash,
      profile: { create: { displayName: 'Paolo Reyes', firstName: 'Paolo', lastName: 'Reyes' } },
    },
    update: {
      emailVerifiedAt: new Date(),
      mobileNumber: '+639171234567',
      mobileVerifiedAt: new Date(),
      passwordHash,
    },
  });
  for (const role of [renterRole, ownerRole])
    await client.userRole.upsert({
      where: { userId_roleId: { userId: ownerUser.id, roleId: role.id } },
      create: { userId: ownerUser.id, roleId: role.id },
      update: {},
    });
  const owner = await client.ownerProfile.upsert({
    where: { userId: ownerUser.id },
    create: {
      id: stableId('11', 1),
      userId: ownerUser.id,
      status: OwnerProfileStatus.VERIFIED,
      legalName: 'Paolo Reyes',
      contactNumber: '+639171234567',
      addressLine1: 'Development Demo Address',
      barangay: 'Poblacion',
      city: 'Makati City',
      province: 'Metro Manila',
      postalCode: '1210',
      submittedAt: new Date(),
      verifiedAt: new Date(),
    },
    update: {
      addressLine1: 'Development Demo Address',
      barangay: 'Poblacion',
      city: 'Makati City',
      contactNumber: '+639171234567',
      legalName: 'Paolo Reyes',
      postalCode: '1210',
      province: 'Metro Manila',
      rejectedAt: null,
      rejectionReason: null,
      status: OwnerProfileStatus.VERIFIED,
      submittedAt: new Date(),
      suspendedAt: null,
      suspensionReason: null,
      verifiedAt: new Date(),
    },
  });
  const dualRoleUser = await client.user.upsert({
    where: { normalizedEmail: 'dualrole@demo.carrental.ph' },
    create: {
      id: stableId('10', 3),
      email: 'dualrole@demo.carrental.ph',
      normalizedEmail: 'dualrole@demo.carrental.ph',
      emailVerifiedAt: new Date(),
      mobileNumber: '+639171234568',
      mobileVerifiedAt: new Date(),
      passwordHash,
      profile: { create: { displayName: 'Alex Cruz', firstName: 'Alex', lastName: 'Cruz' } },
    },
    update: {
      emailVerifiedAt: new Date(),
      mobileNumber: '+639171234568',
      mobileVerifiedAt: new Date(),
      passwordHash,
    },
  });
  for (const role of [renterRole, ownerRole])
    await client.userRole.upsert({
      where: { userId_roleId: { userId: dualRoleUser.id, roleId: role.id } },
      create: { userId: dualRoleUser.id, roleId: role.id },
      update: {},
    });
  const dualRoleOwner = await client.ownerProfile.upsert({
    where: { userId: dualRoleUser.id },
    create: {
      id: stableId('11', 2),
      userId: dualRoleUser.id,
      status: OwnerProfileStatus.VERIFIED,
      legalName: 'Alex Cruz',
      contactNumber: '+639171234568',
      addressLine1: 'Development Demo Address',
      barangay: 'Poblacion',
      city: 'Makati City',
      province: 'Metro Manila',
      postalCode: '1210',
      submittedAt: new Date(),
      verifiedAt: new Date(),
    },
    update: {
      rejectedAt: null,
      rejectionReason: null,
      status: OwnerProfileStatus.VERIFIED,
      submittedAt: new Date(),
      suspendedAt: null,
      suspensionReason: null,
      verifiedAt: new Date(),
    },
  });
  const imagePath = resolve(import.meta.dirname, '../../../apps/mobile/assets/demo-vehicle.png');
  const image = await readFile(imagePath);
  const checksum = createHash('sha256').update(image).digest('hex');
  const configuredRoot = process.env.OBJECT_STORAGE_ROOT ?? '.data/objects';
  const objectRoot = isAbsolute(configuredRoot)
    ? configuredRoot
    : resolve(import.meta.dirname, '../../../apps/api', configuredRoot);
  const requiredDocuments = await client.vehicleDocumentDefinition.findMany({
    where: { active: true, jurisdiction: 'PH', required: true },
    orderBy: { sortOrder: 'asc' },
  });
  const categoryIndex = new Map(
    (await client.vehicleCategory.findMany()).map((item) => [item.code, item]),
  );
  const featureIndex = new Map(
    (await client.vehicleFeature.findMany()).map((item) => [item.code, item]),
  );

  for (const [index, data] of demoVehicles.entries()) {
    const ordinal = index + 1;
    const listingOwner = ordinal === demoVehicles.length ? dualRoleOwner : owner;
    const listingOwnerUser = ordinal === demoVehicles.length ? dualRoleUser : ownerUser;
    const vehicleId = stableId('33', ordinal);
    const category = categoryIndex.get(data.category)!;
    const vehicle = await client.vehicle.upsert({
      where: { id: vehicleId },
      create: {
        id: vehicleId,
        ownerProfileId: listingOwner.id,
        ownerUserId: listingOwnerUser.id,
        categoryId: category.id,
        status: VehicleLifecycleStatus.APPROVED,
        operationalStatus: VehicleOperationalStatus.AVAILABLE,
        make: data.make,
        model: data.model,
        modelYear: data.year,
        transmission: data.transmission,
        powertrain: data.powertrain,
        fuelType: data.fuel,
        seatCount: data.seats,
        doorCount: 5,
        color: ordinal % 2 ? 'Pearl White' : 'Metallic Gray',
        description: data.description,
        rentalRequirements: 'Valid driver license and government-issued ID required.',
        submittedAt: new Date('2026-07-01T00:00:00.000Z'),
        approvedAt: new Date('2026-07-02T00:00:00.000Z'),
      },
      update: {
        categoryId: category.id,
        description: data.description,
        operationalStatus: VehicleOperationalStatus.AVAILABLE,
        ownerProfileId: listingOwner.id,
        ownerUserId: listingOwnerUser.id,
        status: VehicleLifecycleStatus.APPROVED,
      },
    });
    await client.vehicleLocation.upsert({
      where: { vehicleId },
      create: {
        vehicleId,
        latitude: data.latitude,
        longitude: data.longitude,
        city: data.city,
        province: data.province,
        pickupAreaLabel: `${data.city} central pickup area`,
      },
      update: {
        latitude: data.latitude,
        longitude: data.longitude,
        city: data.city,
        province: data.province,
      },
    });
    const policyVersion = await client.vehiclePolicyVersion.findUnique({
      where: { vehicleId_version: { vehicleId, version: 1 } },
    });
    if (!policyVersion)
      await client.vehiclePolicyVersion.create({
        data: {
          vehicleId,
          version: 1,
          dailyRateMinor: data.daily,
          minimumRentalDays: 1,
          maximumRentalDays: 30,
          mileagePolicy:
            data.mileage === null ? MileagePolicyType.UNLIMITED : MileagePolicyType.LIMITED,
          includedKilometersPerDay: data.mileage,
          excessKilometerRateMinor: data.excess,
          fuelReturnPolicy:
            data.powertrain === VehiclePowertrain.BATTERY_ELECTRIC
              ? null
              : FuelReturnPolicyType.SAME_TO_SAME,
          fuelTolerancePercent: data.powertrain === VehiclePowertrain.BATTERY_ELECTRIC ? null : 5,
          evReturnPolicy:
            data.powertrain === VehiclePowertrain.BATTERY_ELECTRIC
              ? EvReturnPolicyType.SAME_TO_SAME
              : null,
          evTolerancePercent: data.powertrain === VehiclePowertrain.BATTERY_ELECTRIC ? 5 : null,
          turnaroundMinutes: ordinal % 3 === 0 ? 240 : 120,
          availabilityPolicy: AvailabilityPolicyType.EVERY_DAY,
          createdByUserId: listingOwnerUser.id,
        },
      });
    for (const code of data.features) {
      const feature = featureIndex.get(code);
      if (feature)
        await client.vehicleFeatureAssignment.upsert({
          where: { vehicleId_featureId: { vehicleId, featureId: feature.id } },
          create: { vehicleId, featureId: feature.id },
          update: {},
        });
    }
    const photoFileId = stableId('44', ordinal);
    await writeDemoAsset(
      client,
      objectRoot,
      image,
      checksum,
      listingOwnerUser.id,
      photoFileId,
      FileClassification.PUBLIC,
      `demo-${data.make.toLowerCase()}-${data.model.toLowerCase().replaceAll(' ', '-')}.png`,
    );
    await client.vehiclePhoto.upsert({
      where: { fileAssetId: photoFileId },
      create: {
        id: stableId('45', ordinal),
        vehicleId,
        fileAssetId: photoFileId,
        perspective: VehiclePhotoPerspective.FRONT,
        displayOrder: 0,
        isCover: true,
      },
      update: { isCover: true },
    });
    for (const [documentIndex, definition] of requiredDocuments.entries()) {
      const assetOrdinal = ordinal * 10 + documentIndex;
      const documentFileId = stableId('55', assetOrdinal);
      await writeDemoAsset(
        client,
        objectRoot,
        image,
        checksum,
        listingOwnerUser.id,
        documentFileId,
        FileClassification.SENSITIVE,
        `demo-${definition.code.toLowerCase()}.png`,
      );
      await client.vehicleDocument.upsert({
        where: {
          vehicleId_definitionId_version: { vehicleId, definitionId: definition.id, version: 1 },
        },
        create: {
          id: stableId('66', assetOrdinal),
          vehicleId,
          definitionId: definition.id,
          fileAssetId: documentFileId,
          version: 1,
          status: VerificationStatus.VERIFIED,
          reviewedAt: new Date('2026-07-02T00:00:00.000Z'),
        },
        update: { status: VerificationStatus.VERIFIED },
      });
    }
    const reviewCount = 3 + ordinal;
    const average = 4 + (ordinal % 8) / 10;
    await client.ratingProjection.upsert({
      where: { subjectType_subjectId: { subjectType: ReviewType.VEHICLE, subjectId: vehicle.id } },
      create: {
        subjectType: ReviewType.VEHICLE,
        subjectId: vehicle.id,
        reviewCount,
        ratingSum: Math.round(average * reviewCount),
        averageRating: average.toFixed(2),
      },
      update: {
        reviewCount,
        ratingSum: Math.round(average * reviewCount),
        averageRating: average.toFixed(2),
        recalculatedAt: new Date(),
      },
    });
  }
  await client.ratingProjection.upsert({
    where: { subjectType_subjectId: { subjectType: ReviewType.OWNER, subjectId: owner.id } },
    create: {
      subjectType: ReviewType.OWNER,
      subjectId: owner.id,
      reviewCount: 28,
      ratingSum: 135,
      averageRating: '4.82',
    },
    update: { reviewCount: 28, ratingSum: 135, averageRating: '4.82', recalculatedAt: new Date() },
  });
  await client.ratingProjection.upsert({
    where: {
      subjectType_subjectId: { subjectType: ReviewType.OWNER, subjectId: dualRoleOwner.id },
    },
    create: {
      subjectType: ReviewType.OWNER,
      subjectId: dualRoleOwner.id,
      reviewCount: 6,
      ratingSum: 29,
      averageRating: '4.83',
    },
    update: { reviewCount: 6, ratingSum: 29, averageRating: '4.83', recalculatedAt: new Date() },
  });
}

async function writeDemoAsset(
  client: PrismaClient,
  root: string,
  content: Buffer,
  checksum: string,
  userId: string,
  id: string,
  classification: FileClassification,
  originalName: string,
) {
  const objectKey = `${userId}/${id}`;
  await mkdir(resolve(root, userId), { recursive: true, mode: 0o700 });
  await writeFile(resolve(root, objectKey), content, { mode: 0o600 });
  await client.fileAsset.upsert({
    where: { id },
    create: {
      id,
      objectKey,
      classification,
      status: FileAssetStatus.READY,
      originalName,
      mimeType: 'image/png',
      size: BigInt(content.byteLength),
      checksum,
      uploadedById: userId,
    },
    update: {
      status: FileAssetStatus.READY,
      checksum,
      size: BigInt(content.byteLength),
      uploadedById: userId,
    },
  });
}
