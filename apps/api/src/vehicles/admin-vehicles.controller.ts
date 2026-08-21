import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { requestMetadata } from '../auth/auth.controller';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { CurrentPrincipal, RequirePermissions } from '../authorization/authorization.decorator';
import { PolicyGuard } from '../authorization/policy.guard';
import type { RequestPrincipal } from '../security/security-context';
import { AdminVehicleQueryDto, VehicleReasonDto } from './vehicles.dto';
import { VehiclesService } from './vehicles.service';

@ApiBearerAuth()
@ApiTags('Administration - vehicles')
@Controller('admin/vehicles')
@UseGuards(AccessTokenGuard, PolicyGuard)
export class AdminVehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  @RequirePermissions('vehicles.read')
  list(@Query() query: AdminVehicleQueryDto) {
    return this.vehicles.listAdmin(query.status);
  }

  @Get(':id')
  @RequirePermissions('vehicles.read')
  detail(@Param('id') id: string) {
    return this.vehicles.adminDetail(id);
  }

  @Post(':id/approval')
  @RequirePermissions('vehicles.review')
  approve(
    @Param('id') id: string,
    @CurrentPrincipal() actor: RequestPrincipal,
    @Req() request: Request,
  ) {
    return this.vehicles.approve(id, actor.userId, requestMetadata(request));
  }

  @Post(':id/change-request')
  @RequirePermissions('vehicles.review')
  requestChanges(
    @Param('id') id: string,
    @Body() input: VehicleReasonDto,
    @CurrentPrincipal() actor: RequestPrincipal,
    @Req() request: Request,
  ) {
    return this.vehicles.requestChanges(id, input.reason, actor.userId, requestMetadata(request));
  }

  @Post(':id/rejection')
  @RequirePermissions('vehicles.review')
  reject(
    @Param('id') id: string,
    @Body() input: VehicleReasonDto,
    @CurrentPrincipal() actor: RequestPrincipal,
    @Req() request: Request,
  ) {
    return this.vehicles.reject(id, input.reason, actor.userId, requestMetadata(request));
  }

  @Post(':id/suspension')
  @RequirePermissions('vehicles.suspend')
  suspend(
    @Param('id') id: string,
    @Body() input: VehicleReasonDto,
    @CurrentPrincipal() actor: RequestPrincipal,
    @Req() request: Request,
  ) {
    return this.vehicles.suspend(id, input.reason, actor.userId, requestMetadata(request));
  }

  @Post(':id/restoration')
  @RequirePermissions('vehicles.suspend')
  restore(
    @Param('id') id: string,
    @Body() input: VehicleReasonDto,
    @CurrentPrincipal() actor: RequestPrincipal,
    @Req() request: Request,
  ) {
    return this.vehicles.restore(id, input.reason, actor.userId, requestMetadata(request));
  }
}
