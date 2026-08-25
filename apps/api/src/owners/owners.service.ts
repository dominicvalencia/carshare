import { HttpStatus, Injectable } from '@nestjs/common';
import {
  FileClassification,
  FileAssetStatus,
  OwnerProfileStatus,
  RoleCode,
  VerificationStatus,
  VerificationType,
} from '@carrental/database';
import { IdentityErrorCode } from '@carrental/api-contracts';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import { SecurityEventService } from '../security/security-event.service';
import type { RequestMetadata } from '../security/security-context';
import type { SubmitOwnerProfileDto, UpdateOwnerProfileDto } from './owners.dto';

@Injectable()
export class OwnersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly events: SecurityEventService,
  ) {}

  async start(userId: string) {
    return this.database.client.$transaction(async (transaction) => {
      const ownerRole = await transaction.role.findUniqueOrThrow({
        where: { code: RoleCode.OWNER },
      });
      await transaction.userRole.upsert({
        create: { roleId: ownerRole.id, userId },
        update: {},
        where: { userId_roleId: { roleId: ownerRole.id, userId } },
      });
      return transaction.ownerProfile.upsert({
        create: { userId },
        include: { verifications: { include: { documents: { include: { fileAsset: true } } } } },
        update: {},
        where: { userId },
      });
    });
  }

  async get(userId: string) {
    const profile = await this.database.client.ownerProfile.findUnique({
      where: { userId },
      include: { verifications: { include: { documents: { include: { fileAsset: true } } } } },
    });
    if (!profile) {
      throw new ApplicationException(
        IdentityErrorCode.OWNER_PROFILE_NOT_FOUND,
        'Owner onboarding has not been started.',
        HttpStatus.NOT_FOUND,
      );
    }
    return profile;
  }

  async update(userId: string, input: UpdateOwnerProfileDto) {
    const profile = await this.get(userId);
    const editable: readonly OwnerProfileStatus[] = [
      OwnerProfileStatus.DRAFT,
      OwnerProfileStatus.REJECTED,
    ];
    if (!editable.includes(profile.status)) {
      throw new ApplicationException(
        IdentityErrorCode.PERMISSION_DENIED,
        'This owner profile cannot be edited in its current state.',
        HttpStatus.CONFLICT,
      );
    }
    return this.database.client.ownerProfile.update({
      data: Object.fromEntries(
        Object.entries(input).map(([key, value]) => [
          key,
          typeof value === 'string' ? value.trim() : value,
        ]),
      ),
      where: { id: profile.id },
    });
  }

  async submit(userId: string, input: SubmitOwnerProfileDto, metadata: RequestMetadata) {
    const profile = await this.get(userId);
    const submittable: readonly OwnerProfileStatus[] = [
      OwnerProfileStatus.DRAFT,
      OwnerProfileStatus.REJECTED,
    ];
    if (!submittable.includes(profile.status)) {
      throw new ApplicationException(
        IdentityErrorCode.PERMISSION_DENIED,
        'This owner profile cannot be submitted in its current state.',
        HttpStatus.CONFLICT,
      );
    }
    if (
      !profile.legalName ||
      !profile.contactNumber ||
      !profile.addressLine1 ||
      !profile.city ||
      !profile.province ||
      !profile.postalCode
    ) {
      throw new ApplicationException(
        'OWNER_PROFILE_INCOMPLETE',
        'Complete all required owner details before submission.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const files = await this.database.client.fileAsset.findMany({
      where: {
        classification: FileClassification.SENSITIVE,
        id: { in: input.verificationFileIds },
        status: FileAssetStatus.READY,
        uploadedById: userId,
      },
    });
    if (files.length !== new Set(input.verificationFileIds).size || files.length === 0) {
      throw new ApplicationException(
        'OWNER_VERIFICATION_DOCUMENT_REQUIRED',
        'Attach at least one valid sensitive verification document.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const now = new Date();
    const result = await this.database.client.$transaction(async (transaction) => {
      await transaction.verification.updateMany({
        data: { status: VerificationStatus.EXPIRED },
        where: { ownerProfileId: profile.id, status: VerificationStatus.REJECTED },
      });
      const verification = await transaction.verification.create({
        data: {
          documents: {
            create: files.map((file) => ({ documentType: 'OWNER_IDENTITY', fileAssetId: file.id })),
          },
          ownerProfileId: profile.id,
          status: VerificationStatus.PENDING,
          submittedAt: now,
          type: VerificationType.OWNER,
          userId,
        },
      });
      const owner = await transaction.ownerProfile.update({
        data: {
          rejectionReason: null,
          rejectedAt: null,
          status: OwnerProfileStatus.PENDING_VERIFICATION,
          submittedAt: now,
        },
        where: { id: profile.id },
      });
      return { owner, verificationId: verification.id };
    });
    await this.events.record('OWNER_ONBOARDING_SUBMITTED', { ...metadata, userId });
    return result;
  }

  async assertOperational(userId: string): Promise<void> {
    const profile = await this.assertOwnerCapability(userId);
    if (profile.status !== OwnerProfileStatus.VERIFIED) {
      throw new ApplicationException(
        IdentityErrorCode.OWNER_VERIFICATION_REQUIRED,
        'A verified owner profile is required.',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  async assertDraftCapable(userId: string): Promise<void> {
    const profile = await this.assertOwnerCapability(userId);
    if (profile.status === OwnerProfileStatus.SUSPENDED) {
      throw new ApplicationException(
        IdentityErrorCode.OWNER_VERIFICATION_REQUIRED,
        'This owner profile is suspended.',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private async assertOwnerCapability(userId: string) {
    const [role, profile] = await Promise.all([
      this.database.client.userRole.findFirst({
        where: { role: { code: RoleCode.OWNER }, userId },
      }),
      this.database.client.ownerProfile.findUnique({ where: { userId } }),
    ]);
    if (!role) {
      throw new ApplicationException(
        IdentityErrorCode.ROLE_REQUIRED,
        'OWNER role is required.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (!profile) {
      throw new ApplicationException(
        IdentityErrorCode.OWNER_PROFILE_NOT_FOUND,
        'Owner onboarding has not been started.',
        HttpStatus.FORBIDDEN,
      );
    }
    return profile;
  }
}
