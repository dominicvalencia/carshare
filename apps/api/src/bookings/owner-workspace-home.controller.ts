import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { CurrentPrincipal } from '../authorization/authorization.decorator';
import { OwnerAccessGuard } from '../owner-access/owner-access.guard';
import type { RequestPrincipal } from '../security/security-context';
import { OwnerHomeUpcomingQueryDto } from './owner-home.dto';
import { OwnerHomeService } from './owner-home.service';

@Controller('owner/workspaces/:ownerProfileId/home')
@UseGuards(AccessTokenGuard, OwnerAccessGuard)
export class OwnerWorkspaceHomeController {
  constructor(private readonly home: OwnerHomeService) {}

  @Get()
  today(@CurrentPrincipal() principal: RequestPrincipal) {
    return this.home.todayForAccess(principal.ownerAccess!);
  }

  @Get('upcoming')
  upcoming(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Query() query: OwnerHomeUpcomingQueryDto,
  ) {
    return this.home.upcomingForAccess(principal.ownerAccess!, query);
  }
}
