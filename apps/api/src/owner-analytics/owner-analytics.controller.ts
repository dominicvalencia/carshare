import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { OwnerAnalyticsQueryDto } from './owner-analytics.dto';
import { OwnerAnalyticsService } from './owner-analytics.service';
import { OwnerOnlyGuard } from './owner-only.guard';

@ApiBearerAuth()
@ApiTags('Owner analytics')
@Controller('admin/owner/analytics')
@UseGuards(AccessTokenGuard, OwnerOnlyGuard)
export class OwnerAnalyticsController {
  constructor(private readonly analytics: OwnerAnalyticsService) {}

  @Get('overview')
  overview(@Query() query: OwnerAnalyticsQueryDto) {
    return this.analytics.overview(query);
  }
}
