import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { OwnerAnalyticsQueryDto } from './owner-analytics.dto';
import { OwnerMarketplaceReportsService } from './owner-marketplace-reports.service';
import { OwnerMarketplaceTrendsService } from './owner-marketplace-trends.service';
import { OwnerOnlyGuard } from './owner-only.guard';

@ApiBearerAuth()
@ApiTags('Owner marketplace reports')
@Controller('admin/owner/reports/marketplace')
@UseGuards(AccessTokenGuard, OwnerOnlyGuard)
export class OwnerMarketplaceReportsController {
  constructor(
    private readonly reports: OwnerMarketplaceReportsService,
    private readonly trendsService: OwnerMarketplaceTrendsService,
  ) {}

  @Get()
  marketplace(@Query() query: OwnerAnalyticsQueryDto) {
    return this.reports.marketplace(query);
  }

  @Get('trends')
  trends(@Query() query: OwnerAnalyticsQueryDto) {
    return this.trendsService.trends(query);
  }
}
