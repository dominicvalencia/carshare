import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { RoleCode } from '@carrental/database';
import { requestMetadata } from '../auth/auth.controller';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { CurrentPrincipal, RequireRoles } from '../authorization/authorization.decorator';
import { PolicyGuard } from '../authorization/policy.guard';
import type { RequestPrincipal } from '../security/security-context';
import { VehicleChangeProposalsService } from './vehicle-change-proposals.service';
import { ReturnVehicleChangeProposalDto } from './vehicles.dto';

@Controller('owner')
@RequireRoles(RoleCode.OWNER)
@UseGuards(AccessTokenGuard, PolicyGuard)
export class OwnerVehicleChangeProposalsController {
  constructor(private readonly proposals: VehicleChangeProposalsService) {}

  @Get('vehicle-change-proposals')
  list(@CurrentPrincipal() principal: RequestPrincipal) {
    return this.proposals.listForOwner(principal.userId);
  }

  @Get('vehicles/:vehicleId/change-proposals/:proposalId')
  detail(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('vehicleId') vehicleId: string,
    @Param('proposalId') proposalId: string,
  ) {
    return this.proposals.ownerDetail(principal.userId, vehicleId, proposalId);
  }

  @Post('vehicles/:vehicleId/change-proposals/:proposalId/approval')
  approve(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('vehicleId') vehicleId: string,
    @Param('proposalId') proposalId: string,
    @Req() request: Request,
  ) {
    return this.proposals.approve(
      principal.userId,
      vehicleId,
      proposalId,
      requestMetadata(request),
    );
  }

  @Post('vehicles/:vehicleId/change-proposals/:proposalId/change-request')
  returnForChanges(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('vehicleId') vehicleId: string,
    @Param('proposalId') proposalId: string,
    @Body() input: ReturnVehicleChangeProposalDto,
    @Req() request: Request,
  ) {
    return this.proposals.returnForChanges(
      principal.userId,
      vehicleId,
      proposalId,
      input.reason,
      requestMetadata(request),
    );
  }
}
