import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { FileAssetStatus, FileClassification } from '@carrental/database';
import { IdentityErrorCode } from '@carrental/api-contracts';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import { CryptoService } from '../security/crypto.service';
import type { RequestPrincipal } from '../security/security-context';
import type { RequestMetadata } from '../security/security-context';
import { AuditService } from '../audit/audit.service';
import { ObjectStorageProvider } from './object-storage.provider';

@Injectable()
export class FilesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: ObjectStorageProvider,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  async upload(userId: string, classification: FileClassification, file: Express.Multer.File) {
    if (!file)
      throw new ApplicationException(
        'FILE_REQUIRED',
        'A file is required.',
        HttpStatus.BAD_REQUEST,
      );
    const acceptedMimeTypes = new Set([
      'application/pdf',
      'image/heic',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
    if (
      classification !== FileClassification.PUBLIC &&
      !acceptedMimeTypes.has(file.mimetype.toLowerCase())
    )
      throw new ApplicationException(
        'FILE_TYPE_INVALID',
        'Private evidence must be a supported image or PDF document.',
        HttpStatus.BAD_REQUEST,
      );
    const id = randomUUID();
    const objectKey = `${userId}/${id}`;
    await this.storage.put(objectKey, file.buffer);
    const asset = await this.database.client.fileAsset.create({
      data: {
        checksum: this.crypto.checksum(file.buffer),
        classification,
        id,
        mimeType: file.mimetype,
        objectKey,
        originalName: file.originalname,
        size: file.size,
        status: FileAssetStatus.READY,
        uploadedById: userId,
      },
    });
    return this.serialize(asset);
  }

  async metadata(id: string, principal: RequestPrincipal) {
    return this.serialize(await this.authorizedAsset(id, principal));
  }

  async content(id: string, principal: RequestPrincipal, request?: RequestMetadata) {
    const asset = await this.authorizedAsset(id, principal);
    await this.auditRenterDocumentAccess(asset, principal, request, 'RENTER_DOCUMENT_VIEWED');
    return { asset, stream: this.storage.open(asset.objectKey) };
  }

  async accessGrant(id: string, principal: RequestPrincipal, request?: RequestMetadata) {
    const asset = await this.authorizedAsset(id, principal);
    await this.auditRenterDocumentAccess(
      asset,
      principal,
      request,
      'RENTER_DOCUMENT_ACCESS_GRANTED',
    );
    return this.createGrant(id, {
      mimeType: asset.mimeType,
      originalName: asset.originalName,
    });
  }

  /** Only call after a service has proved that the asset belongs to a public projection. */
  trustedPublicGrant(id: string) {
    return this.createGrant(id);
  }

  /** Only call after the owning service has already authorized the principal for this asset. */
  trustedAuthorizedGrant(id: string) {
    return this.createGrant(id);
  }

  private createGrant(
    id: string,
    metadata?: { readonly mimeType: string; readonly originalName: string },
  ) {
    const expiresAt = Date.now() + 5 * 60 * 1000;
    const payload = Buffer.from(`${id}:${expiresAt}`).toString('base64url');
    const signature = this.crypto.hashToken(`file-access:${payload}`);
    return {
      contentPath: `/api/v1/file-access/${id}?grant=${payload}.${signature}`,
      expiresAt: new Date(expiresAt),
      grant: `${payload}.${signature}`,
      ...metadata,
    };
  }

  async signedContent(id: string, grant: string) {
    const [payload, signature] = grant.split('.');
    if (!payload || !signature) this.invalidGrant();
    const expected = this.crypto.hashToken(`file-access:${payload}`);
    if (!this.crypto.secureEqual(signature, expected)) this.invalidGrant();
    let decoded = '';
    try {
      decoded = Buffer.from(payload, 'base64url').toString('utf8');
    } catch {
      this.invalidGrant();
    }
    const separator = decoded.lastIndexOf(':');
    const assetId = decoded.slice(0, separator);
    const expiresAt = Number(decoded.slice(separator + 1));
    if (assetId !== id || !Number.isFinite(expiresAt) || expiresAt < Date.now())
      this.invalidGrant();
    const asset = await this.database.client.fileAsset.findFirstOrThrow({
      where: { id, status: FileAssetStatus.READY },
    });
    return { asset, stream: this.storage.open(asset.objectKey) };
  }

  private async authorizedAsset(id: string, principal: RequestPrincipal) {
    const asset = await this.database.client.fileAsset.findUniqueOrThrow({
      include: {
        claimEvidence: {
          select: {
            claim: { select: { booking: { select: { ownerUserId: true, renterUserId: true } } } },
          },
        },
        incidentEvidence: {
          select: {
            incident: {
              select: { booking: { select: { ownerUserId: true, renterUserId: true } } },
            },
          },
        },
        disputeEvidence: {
          select: {
            dispute: {
              select: { booking: { select: { ownerUserId: true, renterUserId: true } } },
            },
          },
        },
        inspectionMedia: {
          select: {
            inspection: {
              select: { booking: { select: { ownerUserId: true, renterUserId: true } } },
            },
          },
        },
        vehicleDocuments: { select: { vehicle: { select: { ownerUserId: true } } } },
        vehiclePhotos: { select: { vehicle: { select: { ownerUserId: true } } } },
        verificationDocuments: {
          select: { id: true, verification: { select: { type: true, userId: true } } },
        },
      },
      where: { id },
    });
    const vehicleOwner = [...asset.vehicleDocuments, ...asset.vehiclePhotos].some(
      ({ vehicle }) => vehicle.ownerUserId === principal.userId,
    );
    const renterVerificationDocument = asset.verificationDocuments.some(({ verification }) =>
      ['IDENTITY', 'DRIVER_LICENSE'].includes(verification.type),
    );
    const ownerVerificationDocument = asset.verificationDocuments.some(
      ({ verification }) => verification.type === 'OWNER',
    );
    const administrative =
      (renterVerificationDocument &&
        principal.permissions.includes('renters.verification_documents.read')) ||
      (ownerVerificationDocument && principal.permissions.includes('owners.read')) ||
      (asset.vehicleDocuments.length > 0 && principal.permissions.includes('vehicles.review')) ||
      (asset.vehiclePhotos.length > 0 && principal.permissions.includes('vehicles.read')) ||
      (asset.inspectionMedia.length > 0 && principal.permissions.includes('inspections.read')) ||
      (asset.claimEvidence.length > 0 && principal.permissions.includes('claims.read')) ||
      (asset.disputeEvidence.length > 0 && principal.permissions.includes('disputes.read')) ||
      (asset.incidentEvidence.length > 0 && principal.permissions.includes('incidents.read'));
    const rentalParticipant = [
      ...asset.inspectionMedia.map(({ inspection }) => inspection.booking),
      ...asset.claimEvidence.map(({ claim }) => claim.booking),
      ...asset.incidentEvidence.map(({ incident }) => incident.booking),
      ...asset.disputeEvidence.map(({ dispute }) => dispute.booking),
    ].some(
      (booking) =>
        booking.ownerUserId === principal.userId || booking.renterUserId === principal.userId,
    );
    const publicAsset = asset.classification === FileClassification.PUBLIC;
    if (
      !publicAsset &&
      asset.uploadedById !== principal.userId &&
      !vehicleOwner &&
      !rentalParticipant &&
      !administrative
    ) {
      throw new ApplicationException(
        IdentityErrorCode.PERMISSION_DENIED,
        'You are not authorized to access this file.',
        HttpStatus.FORBIDDEN,
      );
    }
    return asset;
  }

  private async auditRenterDocumentAccess(
    asset: Awaited<ReturnType<FilesService['authorizedAsset']>>,
    principal: RequestPrincipal,
    request: RequestMetadata | undefined,
    action: string,
  ) {
    const renterDocument = asset.verificationDocuments.find(({ verification }) =>
      ['IDENTITY', 'DRIVER_LICENSE'].includes(verification.type),
    );
    if (!renterDocument || principal.userId === asset.uploadedById) return;
    await this.audit.record({
      action,
      actorUserId: principal.userId,
      metadata: { fileAssetId: asset.id, verificationType: renterDocument.verification.type },
      request: request ?? {},
      targetId: renterDocument.verification.userId,
      targetType: 'RENTER_VERIFICATION_DOCUMENT',
    });
  }

  private invalidGrant(): never {
    throw new ApplicationException(
      IdentityErrorCode.PERMISSION_DENIED,
      'File access grant is invalid or expired.',
      HttpStatus.FORBIDDEN,
    );
  }

  private serialize(asset: {
    id: string;
    classification: FileClassification;
    status: FileAssetStatus;
    originalName: string;
    mimeType: string;
    size: bigint;
    checksum: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      checksum: asset.checksum,
      classification: asset.classification,
      createdAt: asset.createdAt,
      id: asset.id,
      mimeType: asset.mimeType,
      originalName: asset.originalName,
      size: asset.size.toString(),
      status: asset.status,
      updatedAt: asset.updatedAt,
    };
  }
}
