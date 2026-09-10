import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { OwnerMarketplaceReportsController } from './owner-marketplace-reports.controller';
import { OwnerOnlyGuard } from './owner-only.guard';

describe('OwnerMarketplaceReportsController', () => {
  it('publishes the OWNER-only marketplace endpoint and delegates the validated query', async () => {
    const marketplace = vi
      .fn()
      .mockResolvedValue({ definitionVersion: 'owner-marketplace-reports-v1' });
    const controller = new OwnerMarketplaceReportsController({ marketplace } as never);
    const query = { period: 'CUSTOM' as const, startDate: '2026-09-01', endDate: '2026-09-09' };

    await expect(controller.marketplace(query)).resolves.toEqual({
      definitionVersion: 'owner-marketplace-reports-v1',
    });
    expect(marketplace).toHaveBeenCalledWith(query);
    expect(Reflect.getMetadata(PATH_METADATA, OwnerMarketplaceReportsController)).toBe(
      'admin/owner/reports/marketplace',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, OwnerMarketplaceReportsController)).toEqual([
      AccessTokenGuard,
      OwnerOnlyGuard,
    ]);
  });
});
