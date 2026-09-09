import { hash } from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  AdminRole,
  AdminStatus,
  CommissionScope,
  FinancialAccountType,
  RoleCode,
  VerificationType,
} from '../src/generated/prisma/enums';
import { seedDevelopmentDemo } from './development-demo';

const roleDescriptions: Readonly<Record<RoleCode, string>> = {
  ADMIN: 'Platform administrator',
  FINANCE_ADMIN: 'Finance operations administrator',
  OWNER: 'Vehicle owner capability',
  RENTER: 'Marketplace renter capability',
  SUPER_ADMIN: 'Platform super administrator',
  SUPPORT: 'Customer support administrator',
};

const permissionDescriptions = {
  'audit.read': 'Read administrative audit history',
  'commissions.manage': 'Create and disable versioned commission rules',
  'commissions.read': 'Read commission rules and snapshots',
  'owners.read': 'Read owner profiles and verification cases',
  'owners.suspend': 'Suspend owner operational access',
  'owners.verify': 'Approve or reject owner verification',
  'renters.verifications.read': 'Read renter verification queues and case details',
  'renters.verifications.review': 'Review and decide renter verification cases',
  'renters.verifications.suspend': 'Suspend approved renter verification',
  'renters.verification_documents.read': 'Issue audited access to sensitive renter documents',
  'payments.read': 'Read payment operations',
  'rentals.read': 'Read rental operations and lifecycle diagnostics',
  'rentals.intervene': 'Place or release audited operational holds',
  'inspections.read': 'Read private pickup and return inspection evidence',
  'incidents.read': 'Read rental incident reports',
  'incidents.manage': 'Acknowledge and resolve rental incidents',
  'claims.read': 'Read private post-return claims and evidence',
  'claims.review': 'Request evidence and adjudicate post-return claims',
  'claims.resolve': 'Resolve approved or rejected claims',
  'claims.late_override': 'Submit an audited post-deadline claim override',
  'disputes.read': 'Read post-rental disputes and evidence',
  'disputes.manage': 'Open, review, and resolve post-rental disputes',
  'additional_charges.read': 'Read approved additional-charge operations',
  'additional_charges.approve': 'Approve claim-derived additional charges',
  'earnings.read': 'Read owner earning projections and holds',
  'earnings.hold': 'Create and release owner earning holds',
  'earnings.release': 'Release eligible owner earnings to available status',
  'payouts.approve': 'Approve owner payouts',
  'payouts.create': 'Create owner payouts and payout batches',
  'payouts.read': 'Read owner payout operations',
  'payouts.submit': 'Submit approved payouts and reconcile provider state',
  'payouts.cancel': 'Cancel owner payouts before provider submission',
  'payout_accounts.read': 'Read masked owner payout accounts',
  'payout_accounts.manage': 'Manage payout eligibility and payout account readiness',
  'refunds.approve': 'Approve refunds',
  'refunds.read': 'Read refund operations',
  'users.read': 'Read user identity and status information',
  'users.suspend': 'Change user account status',
  'vehicles.read': 'Read owner vehicle listings and review queues',
  'vehicles.review': 'Approve, reject, and request changes to vehicle listings',
  'vehicles.suspend': 'Suspend and restore approved vehicle listings',
  'support.read': 'Read support queues and user-visible support history',
  'support.manage': 'Reply to and change support ticket workflow state',
  'support.assign': 'Assign support tickets to staff',
  'support.internal_notes': 'Create and read staff-only support notes',
  'moderation.read': 'Read user-submitted moderation reports',
  'moderation.manage': 'Resolve moderation reports and moderate reported content',
  'messages.moderate': 'Moderate reported booking messages',
  'reviews.moderate': 'Moderate reported marketplace reviews',
  'staff.view': 'Read staff accounts',
  'staff.create': 'Invite staff accounts',
  'staff.edit': 'Edit staff identity and role',
  'staff.suspend': 'Suspend and reactivate staff accounts',
  'staff.disable': 'Disable staff accounts',
  'staff.permissions.manage': 'Assign approved staff permissions',
} as const;

const rolePermissions: Readonly<Partial<Record<RoleCode, readonly string[]>>> = {
  ADMIN: [
    'audit.read',
    'owners.read',
    'owners.suspend',
    'owners.verify',
    'renters.verifications.read',
    'renters.verifications.review',
    'renters.verifications.suspend',
    'renters.verification_documents.read',
    'users.read',
    'users.suspend',
    'vehicles.read',
    'vehicles.review',
    'vehicles.suspend',
    'commissions.read',
    'rentals.read',
    'rentals.intervene',
    'inspections.read',
    'incidents.read',
    'incidents.manage',
    'claims.read',
    'claims.review',
    'claims.resolve',
    'claims.late_override',
    'disputes.read',
    'disputes.manage',
    'additional_charges.read',
    'additional_charges.approve',
    'earnings.read',
    'earnings.hold',
    'support.read',
    'support.manage',
    'support.assign',
    'support.internal_notes',
    'moderation.read',
    'moderation.manage',
    'messages.moderate',
    'reviews.moderate',
  ],
  FINANCE_ADMIN: [
    'commissions.manage',
    'commissions.read',
    'payments.read',
    'payouts.approve',
    'payouts.create',
    'payouts.read',
    'payouts.submit',
    'payouts.cancel',
    'payout_accounts.read',
    'payout_accounts.manage',
    'refunds.approve',
    'refunds.read',
    'additional_charges.read',
    'earnings.read',
    'earnings.release',
  ],
  SUPPORT: [
    'owners.read',
    'users.read',
    'vehicles.read',
    'rentals.read',
    'inspections.read',
    'incidents.read',
    'claims.read',
    'disputes.read',
    'additional_charges.read',
    'support.read',
    'support.manage',
    'support.assign',
    'support.internal_notes',
    'moderation.read',
    'moderation.manage',
    'messages.moderate',
    'reviews.moderate',
  ],
};

const categories = [
  ['SEDAN', 'Sedan'],
  ['HATCHBACK', 'Hatchback'],
  ['SUV', 'SUV'],
  ['CROSSOVER', 'Crossover'],
  ['MPV', 'MPV'],
  ['PICKUP', 'Pickup Truck'],
  ['VAN', 'Van'],
  ['COUPE', 'Coupe'],
  ['CONVERTIBLE', 'Convertible'],
  ['WAGON', 'Wagon'],
  ['OTHER', 'Other'],
] as const;

const vehicleMakes = [
  ['TOYOTA', 'Toyota'],
  ['HONDA', 'Honda'],
  ['MITSUBISHI', 'Mitsubishi'],
  ['NISSAN', 'Nissan'],
  ['SUZUKI', 'Suzuki'],
  ['FORD', 'Ford'],
  ['HYUNDAI', 'Hyundai'],
  ['KIA', 'Kia'],
  ['ISUZU', 'Isuzu'],
  ['MAZDA', 'Mazda'],
  ['SUBARU', 'Subaru'],
  ['CHEVROLET', 'Chevrolet'],
  ['MG', 'MG'],
  ['GEELY', 'Geely'],
  ['BYD', 'BYD'],
  ['CHERY', 'Chery'],
  ['GAC', 'GAC'],
  ['JETOUR', 'Jetour'],
  ['JAC', 'JAC'],
  ['FOTON', 'Foton'],
  ['VOLKSWAGEN', 'Volkswagen'],
  ['BMW', 'BMW'],
  ['MERCEDES_BENZ', 'Mercedes-Benz'],
  ['AUDI', 'Audi'],
  ['LEXUS', 'Lexus'],
  ['VOLVO', 'Volvo'],
  ['PORSCHE', 'Porsche'],
  ['TESLA', 'Tesla'],
  ['OTHER', 'Other'],
] as const;

const features = [
  ['AIR_CONDITIONING', 'Air conditioning'],
  ['BLUETOOTH', 'Bluetooth'],
  ['APPLE_CARPLAY', 'Apple CarPlay'],
  ['ANDROID_AUTO', 'Android Auto'],
  ['BACKUP_CAMERA', 'Backup camera'],
  ['PARKING_SENSORS', 'Parking sensors'],
  ['CAMERA_360', '360 camera'],
  ['CRUISE_CONTROL', 'Cruise control'],
  ['ADAPTIVE_CRUISE_CONTROL', 'Adaptive cruise control'],
  ['KEYLESS_ENTRY', 'Keyless entry'],
  ['USB_CHARGING', 'USB charging'],
  ['CHILD_SEAT_COMPATIBLE', 'Child-seat compatibility'],
  ['GPS_NAVIGATION', 'GPS/navigation'],
  ['DASHCAM', 'Dashcam'],
  ['TOLL_RFID', 'Toll/RFID support'],
] as const;

const documentDefinitions = [
  ['CERTIFICATE_OF_REGISTRATION', 'Certificate of Registration (CR)', true],
  ['CURRENT_REGISTRATION_EVIDENCE', 'Current registration evidence / Official Receipt', true],
  ['INSURANCE_EVIDENCE', 'Insurance evidence', true],
  ['OWNERSHIP_AUTHORIZATION', 'Ownership or authorization evidence', false],
] as const;

const renterDocumentDefinitions = [
  [
    'DRIVER_LICENSE_FRONT',
    'Driver’s license front',
    'DRIVER_LICENSE',
    VerificationType.DRIVER_LICENSE,
  ],
  [
    'DRIVER_LICENSE_BACK',
    'Driver’s license back',
    'DRIVER_LICENSE',
    VerificationType.DRIVER_LICENSE,
  ],
  [
    'ADDITIONAL_GOVERNMENT_ID',
    'Additional government-issued ID',
    'GOVERNMENT_ID',
    VerificationType.IDENTITY,
  ],
  [
    'PROOF_OF_ADDRESS',
    'Proof of residential address',
    'PROOF_OF_ADDRESS',
    VerificationType.IDENTITY,
  ],
  ['SELFIE', 'New camera selfie for manual review', 'SELFIE', VerificationType.IDENTITY],
] as const;

async function seed(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for seeding.');

  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const roles = new Map<RoleCode, { id: string }>();
    for (const code of Object.values(RoleCode)) {
      const role = await client.role.upsert({
        create: { code, description: roleDescriptions[code] },
        update: { description: roleDescriptions[code] },
        where: { code },
        select: { id: true },
      });
      roles.set(code, role);
    }

    const permissions = new Map<string, { id: string }>();
    for (const [code, description] of Object.entries(permissionDescriptions)) {
      const permission = await client.permission.upsert({
        create: { code, description },
        update: { description },
        where: { code },
        select: { id: true },
      });
      permissions.set(code, permission);
      await client.adminPermission.upsert({
        create: { code, description },
        update: { description },
        where: { code },
      });
    }

    for (const [roleCode, codes] of Object.entries(rolePermissions)) {
      const role = roles.get(roleCode as RoleCode);
      if (!role) continue;
      for (const code of codes ?? []) {
        const permission = permissions.get(code);
        if (!permission) continue;
        await client.rolePermission.upsert({
          create: { permissionId: permission.id, roleId: role.id },
          update: {},
          where: { roleId_permissionId: { permissionId: permission.id, roleId: role.id } },
        });
      }
    }

    const superAdmin = roles.get(RoleCode.SUPER_ADMIN);
    if (superAdmin) {
      for (const permission of permissions.values()) {
        await client.rolePermission.upsert({
          create: { permissionId: permission.id, roleId: superAdmin.id },
          update: {},
          where: {
            roleId_permissionId: { permissionId: permission.id, roleId: superAdmin.id },
          },
        });
      }
    }

    const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
    const adminPassword = process.env.SEED_ADMIN_PASSWORD;
    if (adminEmail && adminPassword) {
      if (adminPassword.length < 12) {
        throw new Error('SEED_ADMIN_PASSWORD must contain at least 12 characters.');
      }
      const passwordHash = await hash(adminPassword, {
        memoryCost: 19_456,
        parallelism: 1,
        timeCost: 2,
        type: 2,
      });
      const user = await client.user.upsert({
        create: {
          email: adminEmail,
          emailVerifiedAt: new Date(),
          normalizedEmail: adminEmail,
          passwordHash,
          profile: { create: { displayName: 'Platform Administrator' } },
        },
        update: { passwordHash },
        where: { normalizedEmail: adminEmail },
        select: { id: true },
      });
      if (!superAdmin) throw new Error('SUPER_ADMIN role was not seeded.');
      await client.userRole.upsert({
        create: { roleId: superAdmin.id, userId: user.id },
        update: {},
        where: { userId_roleId: { roleId: superAdmin.id, userId: user.id } },
      });
      const existingOwner = await client.adminUser.findFirst({
        where: { role: AdminRole.OWNER },
        select: { credentialUserId: true },
      });
      if (existingOwner && existingOwner.credentialUserId !== user.id) {
        throw new Error(
          'An OWNER admin identity already exists; bootstrap is intentionally single-owner.',
        );
      }
      await client.adminUser.upsert({
        create: {
          activatedAt: new Date(),
          credentialUserId: user.id,
          displayName: 'Business Owner',
          email: adminEmail,
          normalizedEmail: adminEmail,
          passwordChangedAt: new Date(),
          role: AdminRole.OWNER,
          status: AdminStatus.ACTIVE,
        },
        update: { status: AdminStatus.ACTIVE },
        where: { credentialUserId: user.id },
      });
    }

    for (const [sortOrder, [code, name]] of categories.entries()) {
      await client.vehicleCategory.upsert({
        create: { code, name, sortOrder },
        update: { active: true, name, sortOrder },
        where: { code },
      });
    }
    for (const [sortOrder, [code, name]] of vehicleMakes.entries()) {
      await client.vehicleMake.upsert({
        create: { code, name, sortOrder },
        update: { active: true, name, sortOrder },
        where: { code },
      });
    }
    for (const [sortOrder, [code, name]] of features.entries()) {
      await client.vehicleFeature.upsert({
        create: { code, name, sortOrder },
        update: { active: true, name, sortOrder },
        where: { code },
      });
    }
    for (const [sortOrder, [code, name, required]] of documentDefinitions.entries()) {
      await client.vehicleDocumentDefinition.upsert({
        create: { code, jurisdiction: 'PH', name, required, sortOrder },
        update: { active: true, name, required, sortOrder },
        where: { jurisdiction_code: { code, jurisdiction: 'PH' } },
      });
    }
    for (const [
      sortOrder,
      [code, name, category, verificationType],
    ] of renterDocumentDefinitions.entries()) {
      await client.renterDocumentDefinition.upsert({
        create: {
          category,
          code,
          jurisdiction: 'PH',
          name,
          required: true,
          sortOrder: (sortOrder + 1) * 10,
          verificationType,
        },
        update: {
          acceptedMimeTypes:
            code === 'SELFIE'
              ? ['image/jpeg', 'image/png']
              : ['image/jpeg', 'image/png', 'application/pdf'],
          active: true,
          category,
          name,
          required: true,
          sortOrder: (sortOrder + 1) * 10,
          verificationType,
        },
        where: { jurisdiction_code: { code, jurisdiction: 'PH' } },
      });
    }

    const financialAccounts = [
      [
        'MAYA_RECEIVABLE',
        FinancialAccountType.PAYMENT_PROVIDER_RECEIVABLE,
        'Payment provider receivable',
      ],
      ['CUSTOMER_FUNDS_HELD', FinancialAccountType.CUSTOMER_FUNDS_HELD, 'Customer funds held'],
      ['OWNER_PAYABLE', FinancialAccountType.OWNER_PAYABLE, 'Owner payable'],
      [
        'PLATFORM_COMMISSION',
        FinancialAccountType.PLATFORM_COMMISSION_REVENUE,
        'Platform commission revenue',
      ],
      ['REFUND_PAYABLE', FinancialAccountType.REFUND_PAYABLE, 'Refund payable'],
      [
        'PAYOUT_PROVIDER_CLEARING',
        FinancialAccountType.PAYOUT_PROVIDER_CLEARING,
        'Payout provider clearing',
      ],
      ['PAYOUT_CASH', FinancialAccountType.PAYOUT_CASH, 'Cash funded for owner payouts'],
      [
        'PAYOUT_PROVIDER_FEES',
        FinancialAccountType.PAYOUT_PROVIDER_FEE_EXPENSE,
        'Platform-funded payout provider fees',
      ],
    ] as const;
    for (const [code, type, name] of financialAccounts) {
      await client.financialAccount.upsert({
        create: { code, currency: 'PHP', name, type },
        update: { active: true, name },
        where: { code_currency: { code, currency: 'PHP' } },
      });
    }
    const defaultCommission = await client.commissionRule.findFirst({
      where: { scope: CommissionScope.PLATFORM_DEFAULT, version: 1 },
    });
    if (!defaultCommission) {
      await client.commissionRule.create({
        data: {
          currency: 'PHP',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          rateBasisPoints: 1500,
          reason:
            'Configurable MVP seed; replace through a new version, never historical mutation.',
          scope: CommissionScope.PLATFORM_DEFAULT,
          version: 1,
        },
      });
    }
    await seedDevelopmentDemo(client);
  } finally {
    await client.$disconnect();
  }
}

void seed();
