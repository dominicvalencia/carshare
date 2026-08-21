import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { FileAssetStatus, FileClassification } from '@carrental/database';
import { IdentityErrorCode } from '@carrental/api-contracts';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import { CryptoService } from '../security/crypto.service';
import type { RequestPrincipal } from '../security/security-context';
import { ObjectStorageProvider } from './object-storage.provider';

@Injectable()
export class FilesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: ObjectStorageProvider,
    private readonly crypto: CryptoService,
  ) {}

  async upload(userId: string, classification: FileClassification, file: Express.Multer.File) {
    if (!file)
      throw new ApplicationException(
        'FILE_REQUIRED',
        'A file is required.',
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

  async content(id: string, principal: RequestPrincipal) {
    const asset = await this.authorizedAsset(id, principal);
    return { asset, stream: this.storage.open(asset.objectKey) };
  }

  async accessGrant(id: string, principal: RequestPrincipal) {
    await this.authorizedAsset(id, principal);
    return this.createGrant(id);
  }

  /** Only call after a service has proved that the asset belongs to a public projection. */
  trustedPublicGrant(id: string) {
    return this.createGrant(id);
  }

  private createGrant(id: string) {
    const expiresAt = Date.now() + 5 * 60 * 1000;
    const payload = Buffer.from(`${id}:${expiresAt}`).toString('base64url');
    const signature = this.crypto.hashToken(`file-access:${payload}`);
    return {
      contentPath: `/api/v1/file-access/${id}?grant=${payload}.${signature}`,
      expiresAt: new Date(expiresAt),
      grant: `${payload}.${signature}`,
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
        verificationDocuments: { select: { id: true } },
      },
      where: { id },
    });
    const vehicleOwner = [...asset.vehicleDocuments, ...asset.vehiclePhotos].some(
      ({ vehicle }) => vehicle.ownerUserId === principal.userId,
    );
    const administrative =
      (asset.verificationDocuments.length > 0 && principal.permissions.includes('owners.read')) ||
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
