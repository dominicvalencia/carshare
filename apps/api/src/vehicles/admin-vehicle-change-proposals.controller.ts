import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { VehicleChangeProposalStatus } from '@carrental/database';
import type { Request } from 'express';
import { requestMetadata } from '../auth/auth.controller';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { CurrentPrincipal, RequirePermissions } from '../authorization/authorization.decorator';
import { PolicyGuard } from '../authorization/policy.guard';
import type { RequestPrincipal } from '../security/security-context';
import { VehicleReasonDto } from './vehicles.dto';
import { AdminVehicleChangeProposalsService } from './admin-vehicle-change-proposals.service';

@ApiBearerAuth()
@ApiTags('Administration - vehicle change proposals')
@Controller('admin/vehicle-change-proposals')
@UseGuards(AccessTokenGuard, PolicyGuard)
export class AdminVehicleChangeProposalsController {
  constructor(private readonly proposals: AdminVehicleChangeProposalsService) {}

  @Get()
  @RequirePermissions('vehicles.read')
  list(@Query('status') status?: VehicleChangeProposalStatus) {
    return this.proposals.list(status);
  }

  @Get(':id')
  @RequirePermissions('vehicles.read')
  detail(@Param('id') id: string) {
    return this.proposals.detail(id);
  }

  @Post(':id/approval')
  @RequirePermissions('vehicles.review')
  approve(
    @Param('id') id: string,
    @CurrentPrincipal() actor: RequestPrincipal,
    @Req() request: Request,
  ) {
    return this.proposals.approve(id, this.adminId(actor), actor.userId, requestMetadata(request));
  }

  @Post(':id/change-request')
  @RequirePermissions('vehicles.review')
  requestChanges(
    @Param('id') id: string,
    @Body() input: VehicleReasonDto,
    @CurrentPrincipal() actor: RequestPrincipal,
    @Req() request: Request,
  ) {
    return this.proposals.requestChanges(
      id,
      input.reason,
      this.adminId(actor),
      actor.userId,
      requestMetadata(request),
    );
  }

  @Post(':id/rejection')
  @RequirePermissions('vehicles.review')
  reject(
    @Param('id') id: string,
    @Body() input: VehicleReasonDto,
    @CurrentPrincipal() actor: RequestPrincipal,
    @Req() request: Request,
  ) {
    return this.proposals.reject(
      id,
      input.reason,
      this.adminId(actor),
      actor.userId,
      requestMetadata(request),
    );
  }

  private adminId(actor: RequestPrincipal): string {
    if (!actor.adminUserId) throw new Error('Admin principal is missing its Admin identity.');
    return actor.adminUserId;
  }
}
