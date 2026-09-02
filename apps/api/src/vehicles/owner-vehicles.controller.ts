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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RoleCode } from '@carrental/database';
import { requestMetadata } from '../auth/auth.controller';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { CurrentPrincipal, RequireRoles } from '../authorization/authorization.decorator';
import { PolicyGuard } from '../authorization/policy.guard';
import type { RequestPrincipal } from '../security/security-context';
import {
  AddVehicleDocumentDto,
  AddVehiclePhotoDto,
  ChangeOperationalStatusDto,
  CreateVehicleBlockDto,
  CreateVehicleDto,
  CreateVehiclePolicyVersionDto,
  ReorderVehiclePhotosDto,
  SetVehicleFeaturesDto,
  SetVehicleLocationDto,
  UpdateVehicleDto,
} from './vehicles.dto';
import { VehiclesService } from './vehicles.service';

@ApiBearerAuth()
@ApiTags('Owner vehicles')
@Controller('owner/vehicles')
@RequireRoles(RoleCode.OWNER)
@UseGuards(AccessTokenGuard, PolicyGuard)
export class OwnerVehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Post()
  create(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Body() input: CreateVehicleDto,
    @Req() request: Request,
  ) {
    return this.vehicles.create(principal.userId, input, requestMetadata(request));
  }

  @Get()
  list(@CurrentPrincipal() principal: RequestPrincipal) {
    return this.vehicles.listOwned(principal.userId);
  }

  @Get(':id')
  detail(@CurrentPrincipal() principal: RequestPrincipal, @Param('id') id: string) {
    return this.vehicles.getOwned(principal.userId, id);
  }

  @Patch(':id')
  update(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: UpdateVehicleDto,
  ) {
    return this.vehicles.update(principal.userId, id, input);
  }

  @Put(':id/features')
  setFeatures(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: SetVehicleFeaturesDto,
  ) {
    return this.vehicles.setFeatures(principal.userId, id, input);
  }

  @Post(':id/photos')
  addPhoto(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: AddVehiclePhotoDto,
  ) {
    return this.vehicles.addPhoto(principal.userId, id, input);
  }

  @Put(':id/photos/order')
  reorderPhotos(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: ReorderVehiclePhotosDto,
  ) {
    return this.vehicles.reorderPhotos(principal.userId, id, input);
  }

  @Delete(':id/photos/:photoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removePhoto(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Param('photoId') photoId: string,
  ) {
    return this.vehicles.removePhoto(principal.userId, id, photoId);
  }

  @Post(':id/documents')
  addDocument(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: AddVehicleDocumentDto,
  ) {
    return this.vehicles.addDocument(principal.userId, id, input);
  }

  @Put(':id/location')
  location(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: SetVehicleLocationDto,
  ) {
    return this.vehicles.setLocation(principal.userId, id, input);
  }

  @Post(':id/policy-versions')
  policy(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: CreateVehiclePolicyVersionDto,
  ) {
    return this.vehicles.createPolicyVersion(principal.userId, id, input);
  }

  @Get(':id/blocked-periods')
  blocks(@CurrentPrincipal() principal: RequestPrincipal, @Param('id') id: string) {
    return this.vehicles.blockedPeriods(principal.userId, id);
  }

  @Post(':id/blocked-periods')
  addBlock(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: CreateVehicleBlockDto,
  ) {
    return this.vehicles.addBlockedPeriod(principal.userId, id, input);
  }

  @Delete(':id/blocked-periods/:blockId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeBlock(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Param('blockId') blockId: string,
  ) {
    return this.vehicles.removeBlockedPeriod(principal.userId, id, blockId);
  }

  @Post(':id/submission')
  submit(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    return this.vehicles.submit(principal.userId, id, requestMetadata(request));
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    return this.vehicles.archive(principal.userId, id, requestMetadata(request));
  }

  @Patch(':id/operational-status')
  operationalStatus(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: ChangeOperationalStatusDto,
  ) {
    return this.vehicles.changeOperationalStatus(principal.userId, id, input);
  }
}

@ApiBearerAuth()
@ApiTags('Vehicle reference data')
@Controller('owner/vehicle-reference-data')
@RequireRoles(RoleCode.OWNER)
@UseGuards(AccessTokenGuard, PolicyGuard)
export class VehicleReferenceDataController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get('categories') categories() {
    return this.vehicles.categories();
  }
  @Get('makes') makes() {
    return this.vehicles.makes();
  }
  @Get('models') models(@Query('makeId') makeId: string) {
    return this.vehicles.models(makeId);
  }
  @Get('features') features() {
    return this.vehicles.features();
  }
  @Get('document-definitions') documents() {
    return this.vehicles.documentDefinitions();
  }
}
