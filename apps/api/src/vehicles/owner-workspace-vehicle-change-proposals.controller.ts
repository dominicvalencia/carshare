import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { requestMetadata } from '../auth/auth.controller';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { CurrentPrincipal } from '../authorization/authorization.decorator';
import { RequireOwnerPermission } from '../owner-access/owner-access.decorator';
import { OwnerAccessGuard } from '../owner-access/owner-access.guard';
import type { RequestPrincipal } from '../security/security-context';
import { VehicleChangeProposalsService } from './vehicle-change-proposals.service';
import {
  AddVehicleChangeProposalDocumentDto,
  AddVehicleChangeProposalPhotoDto,
  ReorderVehicleChangeProposalPhotosDto,
  UpdateVehicleChangeProposalDto,
} from './vehicles.dto';

@Controller('owner/workspaces/:ownerProfileId/vehicles/:vehicleId/change-proposals')
@UseGuards(AccessTokenGuard, OwnerAccessGuard)
@RequireOwnerPermission('vehicles.update_operational_fields')
export class OwnerWorkspaceVehicleChangeProposalsController {
  constructor(private readonly proposals: VehicleChangeProposalsService) {}

  @Post()
  create(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('vehicleId') vehicleId: string,
    @Req() request: Request,
  ) {
    return this.proposals.create(
      principal.ownerAccess!,
      principal.userId,
      vehicleId,
      requestMetadata(request),
    );
  }

  @Get(':proposalId')
  get(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('vehicleId') vehicleId: string,
    @Param('proposalId') proposalId: string,
  ) {
    return this.proposals.get(principal.ownerAccess!, principal.userId, vehicleId, proposalId);
  }

  @Patch(':proposalId')
  update(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('vehicleId') vehicleId: string,
    @Param('proposalId') proposalId: string,
    @Body() input: UpdateVehicleChangeProposalDto,
    @Req() request: Request,
  ) {
    return this.proposals.update(
      principal.ownerAccess!,
      principal.userId,
      vehicleId,
      proposalId,
      input.proposedSnapshot,
      requestMetadata(request),
    );
  }

  @Delete(':proposalId')
  withdraw(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('vehicleId') vehicleId: string,
    @Param('proposalId') proposalId: string,
    @Req() request: Request,
  ) {
    return this.proposals.withdraw(
      principal.ownerAccess!,
      principal.userId,
      vehicleId,
      proposalId,
      requestMetadata(request),
    );
  }

  @Post(':proposalId/submission')
  submit(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('vehicleId') vehicleId: string,
    @Param('proposalId') proposalId: string,
    @Req() request: Request,
  ) {
    return this.proposals.submit(
      principal.ownerAccess!,
      principal.userId,
      vehicleId,
      proposalId,
      requestMetadata(request),
    );
  }

  @Post(':proposalId/photos')
  addPhoto(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('vehicleId') vehicleId: string,
    @Param('proposalId') proposalId: string,
    @Body() input: AddVehicleChangeProposalPhotoDto,
    @Req() request: Request,
  ) {
    return this.proposals.addPhoto(
      principal.ownerAccess!,
      principal.userId,
      vehicleId,
      proposalId,
      input,
      requestMetadata(request),
    );
  }

  @Put(':proposalId/photos/order')
  reorderPhotos(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('vehicleId') vehicleId: string,
    @Param('proposalId') proposalId: string,
    @Body() input: ReorderVehicleChangeProposalPhotosDto,
    @Req() request: Request,
  ) {
    return this.proposals.reorderPhotos(
      principal.ownerAccess!,
      principal.userId,
      vehicleId,
      proposalId,
      input,
      requestMetadata(request),
    );
  }

  @Delete(':proposalId/photos/:fileAssetId')
  removePhoto(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('vehicleId') vehicleId: string,
    @Param('proposalId') proposalId: string,
    @Param('fileAssetId') fileAssetId: string,
    @Req() request: Request,
  ) {
    return this.proposals.removePhoto(
      principal.ownerAccess!,
      principal.userId,
      vehicleId,
      proposalId,
      fileAssetId,
      requestMetadata(request),
    );
  }

  @Post(':proposalId/documents')
  addDocument(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('vehicleId') vehicleId: string,
    @Param('proposalId') proposalId: string,
    @Body() input: AddVehicleChangeProposalDocumentDto,
    @Req() request: Request,
  ) {
    return this.proposals.addDocument(
      principal.ownerAccess!,
      principal.userId,
      vehicleId,
      proposalId,
      input,
      requestMetadata(request),
    );
  }

  @Delete(':proposalId/documents/:definitionId')
  removeDocument(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('vehicleId') vehicleId: string,
    @Param('proposalId') proposalId: string,
    @Param('definitionId') definitionId: string,
    @Req() request: Request,
  ) {
    return this.proposals.removeDocument(
      principal.ownerAccess!,
      principal.userId,
      vehicleId,
      proposalId,
      definitionId,
      requestMetadata(request),
    );
  }
}
