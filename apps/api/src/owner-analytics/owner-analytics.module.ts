import { Module } from '@nestjs/common';
import { PayoutsModule } from '../payouts/payouts.module';
import { OwnerAnalyticsController } from './owner-analytics.controller';
import { OwnerAnalyticsService } from './owner-analytics.service';
import { OwnerOnlyGuard } from './owner-only.guard';
import { OwnerRevenueService } from './owner-revenue.service';
import { OwnerRevenueController } from './owner-revenue.controller';

@Module({
  imports: [PayoutsModule],
  controllers: [OwnerAnalyticsController, OwnerRevenueController],
  providers: [OwnerAnalyticsService, OwnerOnlyGuard, OwnerRevenueService],
})
export class OwnerAnalyticsModule {}
