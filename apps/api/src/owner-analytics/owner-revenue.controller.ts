import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { OwnerAnalyticsQueryDto } from './owner-analytics.dto';
import { OwnerOnlyGuard } from './owner-only.guard';
import { OwnerRevenueService } from './owner-revenue.service';
import { OwnerRevenueTrendsService } from './owner-revenue-trends.service';

@ApiBearerAuth()
@ApiTags('Owner revenue and earnings')
@Controller('admin/owner/revenue')
@UseGuards(AccessTokenGuard, OwnerOnlyGuard)
export class OwnerRevenueController {
  constructor(
    private readonly revenue: OwnerRevenueService,
    private readonly trendsService: OwnerRevenueTrendsService,
  ) {}

  @Get()
  summary(@Query() query: OwnerAnalyticsQueryDto) {
    return this.revenue.summary(query);
  }

  @Get('trends')
  trends(@Query() query: OwnerAnalyticsQueryDto) {
    return this.trendsService.trends(query);
  }
}
