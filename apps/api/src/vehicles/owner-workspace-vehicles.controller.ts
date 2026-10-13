import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
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
import {
  AddVehicleDocumentDto,
  AddVehiclePhotoDto,
  CreateVehicleBlockDto,
  CreateVehicleDto,
  CreateVehiclePolicyVersionDto,
  ManagerVehicleOperationalDetailsDto,
  ManagerVehicleOperationalFeaturesDto,
  ManagerVehicleOperationalPolicyDto,
  ManagerVehicleOperationalStatusDto,
  ReorderVehiclePhotosDto,
  SetVehicleFeaturesDto,
  SetVehicleLocationDto,
  UpdateVehicleDto,
} from './vehicles.dto';

@Controller('owner/workspaces/:ownerProfileId/vehicles')
@UseGuards(AccessTokenGuard, OwnerAccessGuard)
@RequireOwnerPermission('vehicles.view')
export class OwnerWorkspaceVehiclesController {
  constructor(
    private readonly vehicles: VehiclesService,
    private readonly ownerAccess: OwnerAccessService,
  ) {}

  @Post()
  @RequireOwnerPermission('vehicles.create')
  create(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Body() input: CreateVehicleDto,
    @Req() request: Request,
  ) {
    return this.vehicles.createForOwnerAccess(
      principal.ownerAccess!,
      principal.userId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':id/owner-approval-submission')
  @RequireOwnerPermission('vehicles.create')
  submitForOwnerApproval(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    return this.vehicles.submitForOwnerApproval(
      principal.ownerAccess!,
      principal.userId,
      id,
      requestMetadata(request),
    );
  }

  @Delete(':id/owner-approval-submission')
  @RequireOwnerPermission('vehicles.create')
  withdrawOwnerApprovalSubmission(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    return this.vehicles.withdrawOwnerApprovalSubmission(
      principal.ownerAccess!,
      principal.userId,
      id,
      requestMetadata(request),
    );
  }

  @Delete(':id/draft')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireOwnerPermission('vehicles.create')
  discardDraft(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    return this.vehicles.discardDelegatedDraft(
      principal.ownerAccess!,
      principal.userId,
      id,
      requestMetadata(request),
    );
  }

  @Patch(':id')
  @RequireOwnerPermission('vehicles.create')
  updateDraft(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: UpdateVehicleDto,
  ) {
    return this.vehicles.update(principal.userId, id, input, principal.ownerAccess!);
  }

  @Put(':id/features')
  @RequireOwnerPermission('vehicles.create')
  setDraftFeatures(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: SetVehicleFeaturesDto,
  ) {
    return this.vehicles.setFeatures(principal.userId, id, input, principal.ownerAccess!);
  }

  @Post(':id/photos')
  @RequireOwnerPermission('vehicles.create')
  addDraftPhoto(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: AddVehiclePhotoDto,
  ) {
    return this.vehicles.addPhoto(principal.userId, id, input, principal.ownerAccess!);
  }

  @Put(':id/photos/order')
  @RequireOwnerPermission('vehicles.create')
  reorderDraftPhotos(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: ReorderVehiclePhotosDto,
  ) {
    return this.vehicles.reorderPhotos(principal.userId, id, input, principal.ownerAccess!);
  }

  @Delete(':id/photos/:photoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireOwnerPermission('vehicles.create')
  removeDraftPhoto(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Param('photoId') photoId: string,
  ) {
    return this.vehicles.removePhoto(principal.userId, id, photoId, principal.ownerAccess!);
  }

  @Post(':id/documents')
  @RequireOwnerPermission('vehicles.create')
  addDraftDocument(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: AddVehicleDocumentDto,
  ) {
    return this.vehicles.addDocument(principal.userId, id, input, principal.ownerAccess!);
  }

  @Put(':id/location')
  @RequireOwnerPermission('vehicles.create')
  setDraftLocation(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: SetVehicleLocationDto,
  ) {
    return this.vehicles.setLocation(principal.userId, id, input, principal.ownerAccess!);
  }

  @Post(':id/policy-versions')
  @RequireOwnerPermission('vehicles.create')
  createDraftPolicy(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: CreateVehiclePolicyVersionDto,
  ) {
    return this.vehicles.createPolicyVersion(principal.userId, id, input, principal.ownerAccess!);
  }

  @Patch(':id/operational-details')
  @RequireOwnerPermission('vehicles.update_operational_fields')
  updateOperationalDetails(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: ManagerVehicleOperationalDetailsDto,
    @Req() request: Request,
  ) {
    return this.vehicles.updateManagerOperationalDetails(
      principal.ownerAccess!,
      principal.userId,
      id,
      input,
      requestMetadata(request),
    );
  }

  @Put(':id/operational-features')
  @RequireOwnerPermission('vehicles.update_operational_fields')
  updateOperationalFeatures(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: ManagerVehicleOperationalFeaturesDto,
    @Req() request: Request,
  ) {
    return this.vehicles.updateManagerOperationalFeatures(
      principal.ownerAccess!,
      principal.userId,
      id,
      input,
      requestMetadata(request),
    );
  }

  @Post(':id/operational-policy')
  @RequireOwnerPermission('vehicles.update_operational_fields')
  updateOperationalPolicy(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: ManagerVehicleOperationalPolicyDto,
    @Req() request: Request,
  ) {
    return this.vehicles.updateManagerOperationalPolicy(
      principal.ownerAccess!,
      principal.userId,
      id,
      input,
      requestMetadata(request),
    );
  }

  @Patch(':id/operational-status')
  @RequireOwnerPermission('vehicles.update_operational_fields')
  updateOperationalStatus(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: ManagerVehicleOperationalStatusDto,
    @Req() request: Request,
  ) {
    return this.vehicles.updateManagerOperationalStatus(
      principal.ownerAccess!,
      principal.userId,
      id,
      input,
      requestMetadata(request),
    );
  }

  @Get('reference-data/categories')
  @RequireOwnerPermission('vehicles.create')
  categories() {
    return this.vehicles.categories();
  }

  @Get('reference-data/makes')
  @RequireOwnerPermission('vehicles.create')
  makes() {
    return this.vehicles.makes();
  }

  @Get('reference-data/models')
  @RequireOwnerPermission('vehicles.create')
  models(@Query('makeId') makeId: string) {
    return this.vehicles.models(makeId);
  }

  @Get('reference-data/features')
  @RequireOwnerPermission('vehicles.create')
  features() {
    return this.vehicles.features();
  }

  @Get('operational-reference-data/features')
  @RequireOwnerPermission('vehicles.update_operational_fields')
  operationalFeatures() {
    return this.vehicles.features();
  }

  @Get('reference-data/document-definitions')
  @RequireOwnerPermission('vehicles.create')
  documentDefinitions() {
    return this.vehicles.documentDefinitions();
  }

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
