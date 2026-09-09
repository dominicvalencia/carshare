import { Module } from '@nestjs/common';
import { OwnerAnalyticsController } from './owner-analytics.controller';
import { OwnerAnalyticsService } from './owner-analytics.service';
import { OwnerOnlyGuard } from './owner-only.guard';

@Module({
  controllers: [OwnerAnalyticsController],
  providers: [OwnerAnalyticsService, OwnerOnlyGuard],
})
export class OwnerAnalyticsModule {}
