import { HttpStatus, Injectable } from '@nestjs/common';
import type { ApiErrorDetail } from '@carrental/api-contracts';
import { BookingErrorCode } from '@carrental/api-contracts';
import { UserStatus, VerificationStatus, VerificationType, type Prisma } from '@carrental/database';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';

type DatabaseClient = DatabaseService['client'] | Prisma.TransactionClient;
const APPROVED = new Set<VerificationStatus>([
  VerificationStatus.APPROVED,
  VerificationStatus.VERIFIED,
]);

@Injectable()
export class RenterEligibilityService {
  constructor(private readonly database: DatabaseService) {}

  async evaluate(userId: string, client: DatabaseClient = this.database.client) {
    const user = await client.user.findUnique({
      where: { id: userId },
      select: {
        createdAt: true,
        emailVerifiedAt: true,
        mobileVerifiedAt: true,
        mobileNumber: true,
        profile: {
          select: {
            driverLicenseExpiry: true,
            firstName: true,
            lastName: true,
          },
        },
        status: true,
        verifications: {
          orderBy: { updatedAt: 'desc' },
          select: { expiresAt: true, status: true, type: true, updatedAt: true },
          where: { type: { in: [VerificationType.IDENTITY, VerificationType.DRIVER_LICENSE] } },
        },
      },
    });
    const identity = user?.verifications.find(({ type }) => type === VerificationType.IDENTITY);
    const driver = user?.verifications.find(({ type }) => type === VerificationType.DRIVER_LICENSE);
    const today = new Date();
    const details: ApiErrorDetail[] = [];
    if (!user || user.status !== UserStatus.ACTIVE)
      details.push({ field: 'account', issue: 'ACTIVE_ACCOUNT_REQUIRED' });
    if (!user?.emailVerifiedAt) details.push({ field: 'email', issue: 'VERIFIED_EMAIL_REQUIRED' });
    if (!user?.mobileVerifiedAt || !/^\+639\d{9}$/.test(user.mobileNumber ?? ''))
      details.push({ field: 'mobileNumber', issue: 'VERIFIED_PHILIPPINE_MOBILE_REQUIRED' });
    if (!identity || !APPROVED.has(identity.status) || expired(identity.expiresAt, today))
      details.push({ field: 'identityVerification', issue: 'APPROVED_IDENTITY_REQUIRED' });
    const licenseExpiresAt = user?.profile?.driverLicenseExpiry ?? driver?.expiresAt ?? null;
    if (
      !driver ||
      !APPROVED.has(driver.status) ||
      !licenseExpiresAt ||
      expired(licenseExpiresAt, today)
    )
      details.push({ field: 'driverLicense', issue: 'APPROVED_VALID_DRIVER_LICENSE_REQUIRED' });
    return {
      eligible: details.length === 0,
      requirements: details,
      status: renterStatus(identity?.status, driver?.status),
      checks: {
        accountActive: user?.status === UserStatus.ACTIVE,
        driverLicenseVerified:
          Boolean(driver && APPROVED.has(driver.status)) && !expired(licenseExpiresAt, today),
        emailVerified: Boolean(user?.emailVerifiedAt),
        identityVerified: Boolean(identity && APPROVED.has(identity.status)),
        mobileVerified: Boolean(
          user?.mobileVerifiedAt && /^\+639\d{9}$/.test(user.mobileNumber ?? ''),
        ),
      },
    };
  }

  async assertEligible(userId: string, client?: DatabaseClient): Promise<void> {
    const result = await this.evaluate(userId, client);
    if (!result.eligible)
      throw new ApplicationException(
        BookingErrorCode.RENTER_VERIFICATION_REQUIRED,
        'Complete renter verification before reserving or authorizing payment.',
        HttpStatus.FORBIDDEN,
        result.requirements,
      );
  }
}

function expired(value: Date | null | undefined, now: Date) {
  return Boolean(value && value.getTime() < now.getTime());
}

function renterStatus(identity?: VerificationStatus, driver?: VerificationStatus) {
  const values = [identity, driver];
  if (values.includes(VerificationStatus.SUSPENDED)) return 'SUSPENDED';
  if (values.every((value) => value && APPROVED.has(value))) return 'APPROVED';
  if (values.includes(VerificationStatus.UNDER_REVIEW)) return 'UNDER_REVIEW';
  if (values.includes(VerificationStatus.SUBMITTED)) return 'SUBMITTED';
  if (values.includes(VerificationStatus.MORE_INFORMATION_REQUIRED))
    return 'MORE_INFORMATION_REQUIRED';
  if (values.includes(VerificationStatus.REJECTED)) return 'REJECTED';
  return 'DRAFT';
}
