import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { OwnerOnlyGuard } from './owner-only.guard';
import { OwnerRevenueController } from './owner-revenue.controller';

describe('OwnerRevenueController', () => {
  it('publishes the OWNER-only revenue endpoint and delegates the validated query', async () => {
    const summary = vi.fn().mockResolvedValue({ definitionVersion: 'owner-revenue-v1' });
    const trends = vi.fn().mockResolvedValue({ definitionVersion: 'owner-revenue-trends-v1' });
    const controller = new OwnerRevenueController({ summary } as never, { trends } as never);
    const query = { period: 'TODAY' as const };

    await expect(controller.summary(query)).resolves.toEqual({
      definitionVersion: 'owner-revenue-v1',
    });
    expect(summary).toHaveBeenCalledWith(query);
    expect(Reflect.getMetadata(PATH_METADATA, OwnerRevenueController)).toBe('admin/owner/revenue');
    expect(Reflect.getMetadata(GUARDS_METADATA, OwnerRevenueController)).toEqual([
      AccessTokenGuard,
      OwnerOnlyGuard,
    ]);
    await expect(controller.trends({ period: 'THIS_MONTH' })).resolves.toEqual({
      definitionVersion: 'owner-revenue-trends-v1',
    });
    expect(trends).toHaveBeenCalledWith({ period: 'THIS_MONTH' });
  });
});
