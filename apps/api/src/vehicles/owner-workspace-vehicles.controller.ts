import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { requestMetadata } from '../auth/auth.controller';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { CurrentPrincipal } from '../authorization/authorization.decorator';
import { OwnerAccessGuard } from '../owner-access/owner-access.guard';
import { RequireOwnerPermission } from '../owner-access/owner-access.decorator';
import { OwnerAccessService } from '../owner-access/owner-access.service';
import type { RequestPrincipal } from '../security/security-context';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleBlockDto } from './vehicles.dto';

@Controller('owner/workspaces/:ownerProfileId/vehicles')
@UseGuards(AccessTokenGuard, OwnerAccessGuard)
@RequireOwnerPermission('vehicles.view')
export class OwnerWorkspaceVehiclesController {
  constructor(
    private readonly vehicles: VehiclesService,
    private readonly ownerAccess: OwnerAccessService,
  ) {}

  @Get()
  async list(@CurrentPrincipal() principal: RequestPrincipal, @Req() request: Request) {
    const context = principal.ownerAccess!;
    const vehicles = await this.vehicles.listForOwnerAccess(context);
    await this.ownerAccess.auditDelegatedAction({
      action: 'OWNER_WORKSPACE_VEHICLES_VIEWED',
      actorUserId: principal.userId,
      context,
      permission: 'vehicles.view',
      request: requestMetadata(request),
      targetId: context.ownerProfileId,
      targetType: 'OWNER_PROFILE',
    });
    return vehicles;
  }

  @Get(':id')
  async get(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    const context = principal.ownerAccess!;
    const vehicle = await this.vehicles.getForOwnerAccess(context, id);
    await this.ownerAccess.auditDelegatedAction({
      action: 'OWNER_WORKSPACE_VEHICLE_VIEWED',
      actorUserId: principal.userId,
      context,
      permission: 'vehicles.view',
      request: requestMetadata(request),
      targetId: id,
      targetType: 'VEHICLE',
      vehicleId: id,
    });
    return vehicle;
  }

  @Get(':id/blocked-periods')
  @RequireOwnerPermission('availability.view')
  blocks(@CurrentPrincipal() principal: RequestPrincipal, @Param('id') id: string) {
    return this.vehicles.blockedPeriodsForOwnerAccess(principal.ownerAccess!, id);
  }

  @Post(':id/blocked-periods')
  @RequireOwnerPermission('availability.update')
  async addBlock(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: CreateVehicleBlockDto,
    @Req() request: Request,
  ) {
    const context = principal.ownerAccess!;
    const block = await this.vehicles.addBlockedPeriodForOwnerAccess(
      context,
      principal.userId,
      id,
      input,
    );
    await this.ownerAccess.auditDelegatedAction({
      action: 'OWNER_WORKSPACE_AVAILABILITY_BLOCK_CREATED',
      actorUserId: principal.userId,
      context,
      permission: 'availability.update',
      request: requestMetadata(request),
      targetId: block.id,
      targetType: 'VEHICLE_BLOCKED_PERIOD',
      vehicleId: id,
    });
    return block;
  }

  @Delete(':id/blocked-periods/:blockId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireOwnerPermission('availability.update')
  async removeBlock(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Param('blockId') blockId: string,
    @Req() request: Request,
  ) {
    const context = principal.ownerAccess!;
    await this.vehicles.removeBlockedPeriodForOwnerAccess(context, id, blockId);
    await this.ownerAccess.auditDelegatedAction({
      action: 'OWNER_WORKSPACE_AVAILABILITY_BLOCK_REMOVED',
      actorUserId: principal.userId,
      context,
      permission: 'availability.update',
      request: requestMetadata(request),
      targetId: blockId,
      targetType: 'VEHICLE_BLOCKED_PERIOD',
      vehicleId: id,
    });
  }
}
