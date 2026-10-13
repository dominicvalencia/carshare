import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { FilesService } from './files.service';

const proposalAsset = (userId: string, ownerUserId: string) => ({
  checksum: 'checksum',
  claimEvidence: [],
  classification: 'PRIVATE',
  createdAt: new Date('2026-10-13T00:00:00Z'),
  disputeEvidence: [],
  id: '00000000-0000-4000-8000-000000000001',
  incidentEvidence: [],
  inspectionMedia: [],
  mimeType: 'image/jpeg',
  objectKey: 'private/photo',
  originalName: 'proposal.jpg',
  size: 100n,
  status: 'READY',
  updatedAt: new Date('2026-10-13T00:00:00Z'),
  uploadedById: userId,
  vehicleChangeProposalAssets: [
    {
      kind: 'PHOTO',
      proposal: {
        ownerProfile: { userId: ownerUserId },
        submittedByUserId: userId,
      },
    },
  ],
  vehicleDocuments: [],
  vehiclePhotos: [],
  verificationDocuments: [],
});

function setup(asset: ReturnType<typeof proposalAsset>) {
  const database = {
    client: { fileAsset: { findUniqueOrThrow: vi.fn().mockResolvedValue(asset) } },
  };
  const service = new FilesService(
    database as never,
    {} as never,
    {
      hashToken: vi.fn().mockReturnValue('signature'),
    } as never,
    { record: vi.fn() } as never,
  );
  return service;
}

describe('FilesService proposal asset access', () => {
  it.each([
    ['creating Manager', 'manager-user', []],
    ['actual Owner', 'owner-user', []],
    ['authorized Admin', 'admin-user', ['vehicles.review']],
  ])('grants expiring access to the %s', async (_label, userId, permissions) => {
    const result = await setup(proposalAsset('manager-user', 'owner-user')).accessGrant(
      '00000000-0000-4000-8000-000000000001',
      { permissions, userId } as never,
    );
    expect(result.contentPath).toContain('/api/v1/file-access/');
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('denies an unrelated user without vehicle review authority', async () => {
    await expect(
      setup(proposalAsset('manager-user', 'owner-user')).accessGrant(
        '00000000-0000-4000-8000-000000000001',
        { permissions: [], userId: 'unrelated-user' } as never,
      ),
    ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
  });

  it('requires vehicle review authority for a sensitive proposal document', async () => {
    const asset = proposalAsset('manager-user', 'owner-user');
    asset.vehicleChangeProposalAssets[0]!.kind = 'DOCUMENT';
    await expect(
      setup(asset).accessGrant('00000000-0000-4000-8000-000000000001', {
        permissions: ['vehicles.read'],
        userId: 'admin-user',
      } as never),
    ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
  });

  it('marks an unattached failed upload deleted before removing its private object', async () => {
    const database = {
      client: {
        fileAsset: {
          findFirst: vi.fn().mockResolvedValue({ id: 'asset', objectKey: 'user/asset' }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      },
    };
    const storage = { delete: vi.fn().mockResolvedValue(undefined) };
    const service = new FilesService(database as never, storage as never, {} as never, {} as never);
    await expect(service.discardUnattached('user', 'asset')).resolves.toEqual({
      discarded: true,
    });
    expect(database.client.fileAsset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'DELETED' } }),
    );
    expect(storage.delete).toHaveBeenCalledWith('user/asset');
  });
});
