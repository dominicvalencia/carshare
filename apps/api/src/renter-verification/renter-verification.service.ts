import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AddressMatchAssessment,
  FileAssetStatus,
  FileClassification,
  VerificationStatus,
  VerificationType,
  type Prisma,
} from '@carrental/database';
import { ApplicationException } from '../common/errors/application.exception';
import { normalizePhilippineMobile as normalizeCanonicalPhilippineMobile } from '../common/phone/philippine-mobile';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../infrastructure/database/database.service';
import { CryptoService } from '../security/crypto.service';
import type { RequestMetadata } from '../security/security-context';
import { SecurityEventService } from '../security/security-event.service';
import { GeographyService } from '../geography/geography.service';
import type {
  AttachRenterDocumentDto,
  UpdateRenterVerificationProfileDto,
} from './renter-verification.dto';
import { RenterEligibilityService } from './renter-eligibility.service';

const REVIEWABLE = [VerificationType.IDENTITY, VerificationType.DRIVER_LICENSE] as const;
const RENTER_PROFILE_SELECT = {
  addressLine1: true,
  addressScopeCode: true,
  barangay: true,
  barangayCode: true,
  cityMunicipality: true,
  cityMunicipalityCode: true,
  dateOfBirth: true,
  displayName: true,
  driverLicenseClass: true,
  driverLicenseExpiry: true,
  driverLicenseLastFour: true,
  driverLicenseRestrictions: true,
  emergencyContactMobile: true,
  emergencyContactName: true,
  emergencyContactRelation: true,
  emergencyContactRelationOther: true,
  firstName: true,
  lastName: true,
  middleName: true,
  postalCode: true,
  province: true,
  provinceCode: true,
  region: true,
  regionCode: true,
  renterVerificationDraftStep: true,
  updatedAt: true,
} satisfies Prisma.UserProfileSelect;

@Injectable()
export class RenterVerificationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly eligibility: RenterEligibilityService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly events: SecurityEventService,
    private readonly geography: GeographyService,
  ) {}

  async mine(userId: string) {
    const [user, definitions, eligibility] = await Promise.all([
      this.database.client.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          email: true,
          emailVerifiedAt: true,
          mobileNumber: true,
          mobileVerifiedAt: true,
          profile: { select: RENTER_PROFILE_SELECT },
          verifications: {
            include: {
              documents: {
                include: {
                  definition: true,
                  fileAsset: {
                    select: { id: true, mimeType: true, originalName: true, status: true },
                  },
                },
                orderBy: { createdAt: 'desc' },
              },
            },
            orderBy: { updatedAt: 'desc' },
            where: { type: { in: [...REVIEWABLE] } },
          },
        },
      }),
      this.requirements(),
      this.eligibility.evaluate(userId),
    ]);
    return { ...user, definitions, eligibility };
  }

  requirements() {
    return this.database.client.renterDocumentDefinition
      .findMany({
        orderBy: { sortOrder: 'asc' },
        where: { active: true, jurisdiction: 'PH' },
        select: {
          acceptedMimeTypes: true,
          category: true,
          code: true,
          maximumBytes: true,
          name: true,
          required: true,
          verificationType: true,
        },
      })
      .then((items) =>
        items.map((item) => ({ ...item, maximumBytes: item.maximumBytes.toString() })),
      );
  }

  async updateProfile(userId: string, input: UpdateRenterVerificationProfileDto) {
    const user = await this.database.client.user.findUniqueOrThrow({
      select: { mobileNumber: true, profile: true },
      where: { id: userId },
    });
    const stageOrder = {
      PERSONAL_INFORMATION: 1,
      RESIDENTIAL_ADDRESS: 2,
      DRIVER_INFORMATION: 3,
      EMERGENCY_CONTACT: 4,
    } as const;
    const stage = input.stage as keyof typeof stageOrder;
    const data: Prisma.UserProfileUncheckedCreateInput = {
      renterVerificationDraftStep: Math.max(
        user.profile?.renterVerificationDraftStep ?? 0,
        stageOrder[stage],
      ),
      userId,
    };
    if (stage === 'PERSONAL_INFORMATION') {
      data.firstName = normalizeRequired(input.legalFirstName, 'Legal first name');
      data.middleName = optionalNormalized(input.middleName);
      data.lastName = normalizeRequired(input.legalLastName, 'Legal last name');
      data.dateOfBirth = validDateOnly(input.dateOfBirth, 'Date of birth', { future: false });
    }
    if (stage === 'RESIDENTIAL_ADDRESS') {
      const regionCode = required(input.regionCode, 'Region');
      const addressScopeCode = required(input.addressScopeCode, 'Province / geographic area');
      const cityMunicipalityCode = required(input.cityMunicipalityCode, 'City / municipality');
      const barangayCode = required(input.barangayCode, 'Barangay');
      const address = await this.geography.validateAddress({
        addressScopeCode,
        barangayCode,
        cityMunicipalityCode,
        ...(input.provinceCode ? { provinceCode: input.provinceCode } : {}),
        regionCode,
      });
      data.addressLine1 = normalizeRequired(input.addressLine1, 'Address line');
      data.region = address.region.name;
      data.regionCode = address.region.code;
      data.addressScopeCode = address.scope.code;
      data.province = address.province?.name ?? null;
      data.provinceCode = address.province?.code ?? null;
      data.cityMunicipality = address.city.name;
      data.cityMunicipalityCode = address.city.code;
      data.barangay = address.barangay.name;
      data.barangayCode = address.barangay.code;
      data.postalCode = required(input.postalCode, 'Postal code');
    }
    if (stage === 'DRIVER_INFORMATION') {
      const normalizedLicense = input.driverLicenseNumber
        ?.replaceAll(/[^a-zA-Z0-9]/g, '')
        .toUpperCase();
      if (!normalizedLicense && !user.profile?.driverLicenseNumberHash)
        throw validation('Driver’s license number is required.');
      if (normalizedLicense) {
        if (normalizedLicense.length < 4 || normalizedLicense.length > 32)
          throw validation('Enter a valid driver’s license number.');
        const hash = this.crypto.hashIdentifier(`driver-license:${normalizedLicense}`);
        const duplicate = await this.database.client.userProfile.findFirst({
          select: { id: true },
          where: { driverLicenseNumberHash: hash, userId: { not: userId } },
        });
        if (duplicate)
          throw validation('This driver’s license is already associated with another account.');
        data.driverLicenseLastFour = normalizedLicense.slice(-4);
        data.driverLicenseNumberHash = hash;
      }
      data.driverLicenseExpiry = validDateOnly(
        input.driverLicenseExpiry,
        'Driver’s license expiration',
        { future: true },
      );
      data.driverLicenseClass = normalizeRequired(
        input.driverLicenseClass,
        'Driver’s license classification',
      );
      data.driverLicenseRestrictions = optionalNormalized(input.driverLicenseRestrictions);
    }
    if (stage === 'EMERGENCY_CONTACT') {
      const anyEmergencyValue = Boolean(
        input.emergencyContactName ||
        input.emergencyContactMobile ||
        input.emergencyContactRelation,
      );
      if (anyEmergencyValue) {
        const mobile = normalizePhilippineMobile(input.emergencyContactMobile);
        const renterMobile = normalizePhilippineMobile(user.mobileNumber, false);
        if (renterMobile && mobile === renterMobile)
          throw validation('Emergency contact mobile number must be different from your number.');
        data.emergencyContactName = normalizeRequired(
          input.emergencyContactName,
          'Emergency contact name',
        );
        data.emergencyContactMobile = mobile;
        data.emergencyContactRelation = required(
          input.emergencyContactRelation,
          'Emergency contact relationship',
        );
        data.emergencyContactRelationOther =
          input.emergencyContactRelation === 'OTHER'
            ? normalizeRequired(input.emergencyContactRelationOther, 'Relationship description')
            : null;
      } else {
        data.emergencyContactName = null;
        data.emergencyContactMobile = null;
        data.emergencyContactRelation = null;
        data.emergencyContactRelationOther = null;
      }
    }
    const profile = await this.database.client.$transaction(async (transaction) => {
      const updatedProfile = await transaction.userProfile.upsert({
        where: { userId },
        create: data,
        update: data,
      });
      if (stage !== 'EMERGENCY_CONTACT')
        await transaction.verification.updateMany({
          data: {
            ...(stage === 'RESIDENTIAL_ADDRESS'
              ? {
                  addressAssessedAt: null,
                  addressAssessedByUserId: null,
                  addressAssessment: null,
                  addressReviewNotes: null,
                }
              : {}),
            rejectionReason: null,
            reviewedAt: null,
            reviewedByUserId: null,
            status: VerificationStatus.DRAFT,
            submittedAt: null,
          },
          where: {
            status: { not: VerificationStatus.SUSPENDED },
            type: { in: [...REVIEWABLE] },
            userId,
          },
        });
      return updatedProfile;
    });
    await this.ensureDrafts(userId);
    return profile;
  }

  async attachDocument(userId: string, input: AttachRenterDocumentDto) {
    const definition = await this.database.client.renterDocumentDefinition.findFirst({
      where: { active: true, code: input.definitionCode, jurisdiction: 'PH' },
    });
    if (!definition)
      throw new ApplicationException(
        'RENTER_DOCUMENT_DEFINITION_NOT_FOUND',
        'Document requirement not found.',
        HttpStatus.NOT_FOUND,
      );
    const file = await this.database.client.fileAsset.findFirst({
      where: { id: input.fileAssetId, uploadedById: userId, status: FileAssetStatus.READY },
    });
    if (!file || file.classification !== FileClassification.SENSITIVE)
      throw new ApplicationException(
        'RENTER_DOCUMENT_FILE_INVALID',
        'Renter documents must be uploaded as sensitive private files.',
        HttpStatus.BAD_REQUEST,
      );
    if (
      !definition.acceptedMimeTypes.includes(file.mimeType) ||
      file.size > definition.maximumBytes
    )
      throw new ApplicationException(
        'RENTER_DOCUMENT_FILE_INVALID',
        'The document type or size is not accepted for this requirement.',
        HttpStatus.BAD_REQUEST,
      );
    const verification = await this.ensureVerification(userId, definition.verificationType);
    return this.database.client.$transaction(async (transaction) => {
      const previous = await transaction.verificationDocument.findFirst({
        orderBy: { version: 'desc' },
        where: { definitionId: definition.id, replacedAt: null, verificationId: verification.id },
      });
      if (previous)
        await transaction.verificationDocument.update({
          data: { replacedAt: new Date() },
          where: { id: previous.id },
        });
      const document = await transaction.verificationDocument.create({
        data: {
          definitionId: definition.id,
          documentType: definition.code,
          ...(input.expiresAt ? { expiresAt: new Date(input.expiresAt) } : {}),
          fileAssetId: file.id,
          status: VerificationStatus.SUBMITTED,
          verificationId: verification.id,
          version: (previous?.version ?? 0) + 1,
        },
      });
      await transaction.verification.update({
        data: { rejectionReason: null, status: VerificationStatus.DRAFT },
        where: { id: verification.id },
      });
      return document;
    });
  }

  async submit(userId: string, request: RequestMetadata) {
    const [snapshot, privateProfile] = await Promise.all([
      this.mine(userId),
      this.database.client.userProfile.findUnique({
        select: { driverLicenseNumberHash: true },
        where: { userId },
      }),
    ]);
    const missing = submissionRequirements(
      snapshot,
      Boolean(privateProfile?.driverLicenseNumberHash),
    );
    if (missing.length)
      throw new ApplicationException(
        'RENTER_VERIFICATION_INCOMPLETE',
        'Complete all required renter verification fields and documents before submitting.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        missing.map((issue) => ({ issue })),
      );
    const now = new Date();
    await this.database.client.verification.updateMany({
      data: { rejectionReason: null, submittedAt: now, status: VerificationStatus.SUBMITTED },
      where: { userId, type: { in: [...REVIEWABLE] } },
    });
    await this.audit.record({
      action: 'RENTER_VERIFICATION_SUBMITTED',
      actorUserId: userId,
      request,
      targetId: userId,
      targetType: 'RENTER_VERIFICATION',
    });
    return this.mine(userId);
  }

  listAdmin(status?: VerificationStatus) {
    return this.database.client.verification.findMany({
      distinct: ['userId'],
      orderBy: { updatedAt: 'desc' },
      where: {
        type: VerificationType.IDENTITY,
        ...(status
          ? { status }
          : {
              status: {
                in: [
                  VerificationStatus.SUBMITTED,
                  VerificationStatus.UNDER_REVIEW,
                  VerificationStatus.MORE_INFORMATION_REQUIRED,
                ],
              },
            }),
      },
      select: {
        id: true,
        status: true,
        submittedAt: true,
        updatedAt: true,
        user: {
          select: {
            email: true,
            mobileNumber: true,
            profile: { select: { displayName: true, firstName: true, lastName: true } },
          },
        },
        userId: true,
      },
    });
  }

  adminDetail(id: string) {
    return this.database.client.verification.findUniqueOrThrow({
      where: { id },
      include: {
        addressAssessedBy: {
          select: { email: true, profile: { select: { displayName: true } } },
        },
        reviewedBy: {
          select: { email: true, profile: { select: { displayName: true } } },
        },
        documents: {
          where: { replacedAt: null },
          include: {
            definition: true,
            fileAsset: {
              select: { id: true, mimeType: true, originalName: true, size: true, status: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        user: {
          select: {
            createdAt: true,
            email: true,
            emailVerifiedAt: true,
            mobileNumber: true,
            mobileVerifiedAt: true,
            profile: { select: RENTER_PROFILE_SELECT },
            securityEvents: { orderBy: { occurredAt: 'desc' }, take: 25 },
            verifications: {
              include: {
                documents: {
                  where: { replacedAt: null },
                  include: {
                    definition: true,
                    fileAsset: {
                      select: {
                        id: true,
                        mimeType: true,
                        originalName: true,
                        size: true,
                        status: true,
                      },
                    },
                  },
                },
              },
              orderBy: { updatedAt: 'desc' },
              where: { type: { in: [...REVIEWABLE] } },
            },
          },
        },
      },
    });
  }

  async beginReview(id: string, actorUserId: string, request: RequestMetadata) {
    return this.decide(
      id,
      actorUserId,
      VerificationStatus.UNDER_REVIEW,
      'Review started',
      request,
      [VerificationStatus.SUBMITTED],
    );
  }

  async approve(id: string, actorUserId: string, request: RequestMetadata) {
    const root = await this.adminDetail(id);
    if (!root.addressAssessment)
      throw new ApplicationException(
        'RENTER_ADDRESS_ASSESSMENT_REQUIRED',
        'Record an address-versus-document assessment before approval.',
        HttpStatus.CONFLICT,
      );
    if (!root.addressReviewNotes?.trim())
      throw new ApplicationException(
        'RENTER_REVIEW_NOTES_REQUIRED',
        'Save reviewer notes documenting the verification checks before approval.',
        HttpStatus.CONFLICT,
      );
    const [definitions, privateProfile] = await Promise.all([
      this.requirements(),
      this.database.client.userProfile.findUnique({
        select: { driverLicenseNumberHash: true },
        where: { userId: root.userId },
      }),
    ]);
    const missing = submissionRequirements(
      {
        definitions,
        profile: root.user.profile,
        verifications: root.user.verifications,
      },
      Boolean(privateProfile?.driverLicenseNumberHash),
    );
    if (missing.length)
      throw new ApplicationException(
        'RENTER_VERIFICATION_INCOMPLETE',
        'The case cannot be approved while required evidence is incomplete.',
        HttpStatus.CONFLICT,
        missing.map((issue) => ({ issue })),
      );
    return this.decide(
      id,
      actorUserId,
      VerificationStatus.APPROVED,
      'Approved by authorized verification staff',
      request,
      [VerificationStatus.SUBMITTED, VerificationStatus.UNDER_REVIEW],
    );
  }

  moreInformation(id: string, reason: string, actorUserId: string, request: RequestMetadata) {
    return this.decide(
      id,
      actorUserId,
      VerificationStatus.MORE_INFORMATION_REQUIRED,
      reason,
      request,
      [VerificationStatus.SUBMITTED, VerificationStatus.UNDER_REVIEW],
    );
  }

  reject(id: string, reason: string, actorUserId: string, request: RequestMetadata) {
    return this.decide(id, actorUserId, VerificationStatus.REJECTED, reason, request, [
      VerificationStatus.SUBMITTED,
      VerificationStatus.UNDER_REVIEW,
    ]);
  }

  suspend(id: string, reason: string, actorUserId: string, request: RequestMetadata) {
    return this.decide(id, actorUserId, VerificationStatus.SUSPENDED, reason, request, [
      VerificationStatus.APPROVED,
      VerificationStatus.VERIFIED,
    ]);
  }

  async assessAddress(
    id: string,
    assessment: AddressMatchAssessment,
    notes: string | undefined,
    actorUserId: string,
    request: RequestMetadata,
  ) {
    const root = await this.database.client.verification.findUniqueOrThrow({
      select: { type: true, userId: true },
      where: { id },
    });
    if (root.type !== VerificationType.IDENTITY)
      throw new ApplicationException(
        'RENTER_ADDRESS_ASSESSMENT_INVALID_CASE',
        'Address assessment is available only on the renter identity case.',
        HttpStatus.CONFLICT,
      );
    const normalizedNotes = optionalNormalized(notes);
    if (
      (assessment === AddressMatchAssessment.POSSIBLE_MATCH ||
        assessment === AddressMatchAssessment.MISMATCH) &&
      !normalizedNotes
    )
      throw validation('Reviewer notes are required for this address assessment.');
    const result = await this.database.client.verification.update({
      data: {
        addressAssessedAt: new Date(),
        addressAssessedByUserId: actorUserId,
        addressAssessment: assessment,
        addressReviewNotes: normalizedNotes,
      },
      where: { id },
    });
    await this.audit.record({
      action: 'RENTER_ADDRESS_DOCUMENT_ASSESSED',
      actorUserId,
      metadata: { assessment },
      ...(normalizedNotes ? { reason: normalizedNotes } : {}),
      request,
      targetId: root.userId,
      targetType: 'RENTER_VERIFICATION',
    });
    return result;
  }

  private async decide(
    id: string,
    actorUserId: string,
    status: VerificationStatus,
    reason: string,
    request: RequestMetadata,
    allowed: VerificationStatus[],
  ) {
    const root = await this.database.client.verification.findUniqueOrThrow({
      where: { id },
      select: { status: true, userId: true },
    });
    if (!allowed.includes(root.status))
      throw new ApplicationException(
        'RENTER_VERIFICATION_INVALID_STATE',
        `Renter verification cannot move from ${root.status} to ${status}.`,
        HttpStatus.CONFLICT,
      );
    const now = new Date();
    await this.database.client.$transaction(async (transaction) => {
      await transaction.verification.updateMany({
        data: {
          rejectionReason: new Set<VerificationStatus>([
            VerificationStatus.MORE_INFORMATION_REQUIRED,
            VerificationStatus.REJECTED,
            VerificationStatus.SUSPENDED,
          ]).has(status)
            ? reason
            : null,
          reviewedAt: now,
          reviewedByUserId: actorUserId,
          status,
        },
        where: { userId: root.userId, type: { in: [...REVIEWABLE] } },
      });
      if (status === VerificationStatus.APPROVED)
        await transaction.verificationDocument.updateMany({
          data: { reviewFeedback: null, status: VerificationStatus.APPROVED },
          where: {
            replacedAt: null,
            verification: { userId: root.userId, type: { in: [...REVIEWABLE] } },
          },
        });
    });
    await this.audit.record({
      action: `RENTER_VERIFICATION_${status}`,
      actorUserId,
      reason,
      request,
      targetId: root.userId,
      targetType: 'RENTER_VERIFICATION',
    });
    await this.events.record(`RENTER_VERIFICATION_${status}`, { ...request, userId: root.userId });
    return this.mine(root.userId);
  }

  private async ensureDrafts(userId: string) {
    await Promise.all(REVIEWABLE.map((type) => this.ensureVerification(userId, type)));
  }

  private async ensureVerification(userId: string, type: VerificationType) {
    const existing = await this.database.client.verification.findFirst({
      orderBy: { createdAt: 'desc' },
      where: { userId, type },
    });
    return (
      existing ??
      this.database.client.verification.create({
        data: { status: VerificationStatus.DRAFT, type, userId },
      })
    );
  }
}

function validation(message: string) {
  return new ApplicationException(
    'RENTER_VERIFICATION_PROFILE_INVALID',
    message,
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

function required(value: string | undefined, label: string) {
  const normalized = value?.trim();
  if (!normalized) throw validation(`${label} is required.`);
  return normalized;
}

function normalizeRequired(value: string | undefined, label: string) {
  return required(value, label).replaceAll(/\s+/g, ' ');
}

function optionalNormalized(value?: string) {
  const normalized = value?.trim().replaceAll(/\s+/g, ' ');
  return normalized || null;
}

function validDateOnly(
  value: string | undefined,
  label: string,
  rule: { readonly future: boolean },
) {
  const canonical = required(value, label);
  const date = new Date(`${canonical}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== canonical)
    throw validation(`${label} is not a valid date.`);
  const today = new Date().toISOString().slice(0, 10);
  if (rule.future ? canonical <= today : canonical > today)
    throw validation(
      rule.future ? `${label} must be in the future.` : `${label} cannot be in the future.`,
    );
  if (!rule.future && canonical < '1900-01-01') throw validation(`${label} is not plausible.`);
  return date;
}

function normalizePhilippineMobile(value: string | null | undefined, requiredValue = true) {
  const raw = value?.trim();
  if (!raw) {
    if (requiredValue) throw validation('Emergency contact mobile number is required.');
    return null;
  }
  try {
    return normalizeCanonicalPhilippineMobile(raw);
  } catch {
    throw validation('Enter a valid Philippine mobile number.');
  }
}

function submissionRequirements(
  snapshot: {
    readonly definitions: readonly { readonly code: string; readonly required: boolean }[];
    readonly profile: {
      readonly addressLine1?: string | null;
      readonly addressScopeCode?: string | null;
      readonly barangayCode?: string | null;
      readonly cityMunicipality?: string | null;
      readonly cityMunicipalityCode?: string | null;
      readonly dateOfBirth?: Date | null;
      readonly driverLicenseClass?: string | null;
      readonly driverLicenseExpiry?: Date | null;
      readonly firstName?: string | null;
      readonly lastName?: string | null;
      readonly postalCode?: string | null;
      readonly regionCode?: string | null;
      readonly renterVerificationDraftStep?: number;
    } | null;
    readonly verifications: readonly {
      readonly documents: readonly {
        readonly definition?: { readonly code: string } | null;
        readonly replacedAt: Date | null;
      }[];
    }[];
  },
  driverLicenseNumberPresent: boolean,
) {
  const missing: string[] = [];
  const profile = snapshot.profile;
  for (const [field, value] of Object.entries({
    ADDRESS: profile?.addressLine1,
    ADDRESS_SCOPE: profile?.addressScopeCode,
    BARANGAY: profile?.barangayCode,
    CITY_MUNICIPALITY: profile?.cityMunicipality,
    CITY_MUNICIPALITY_CODE: profile?.cityMunicipalityCode,
    DATE_OF_BIRTH: profile?.dateOfBirth,
    DRIVER_LICENSE_CLASS: profile?.driverLicenseClass,
    DRIVER_LICENSE_EXPIRY: profile?.driverLicenseExpiry,
    DRIVER_LICENSE_NUMBER: driverLicenseNumberPresent,
    LEGAL_FIRST_NAME: profile?.firstName,
    LEGAL_LAST_NAME: profile?.lastName,
    POSTAL_CODE: profile?.postalCode,
    REGION: profile?.regionCode,
    VERIFICATION_DRAFT: (profile?.renterVerificationDraftStep ?? 0) >= 3,
  }))
    if (!value) missing.push(`${field}_REQUIRED`);
  if (profile?.driverLicenseExpiry && profile.driverLicenseExpiry <= new Date())
    missing.push('DRIVER_LICENSE_EXPIRED');
  const documentCodes = new Set(
    snapshot.verifications.flatMap(({ documents }) =>
      documents
        .filter(({ replacedAt }) => !replacedAt)
        .map(({ definition }) => definition?.code)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  for (const definition of snapshot.definitions)
    if (definition.required && !documentCodes.has(definition.code))
      missing.push(`${definition.code}_REQUIRED`);
  return [...new Set(missing)];
}
