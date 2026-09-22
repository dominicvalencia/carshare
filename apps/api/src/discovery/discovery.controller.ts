import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import {
  CurrentPrincipal,
  RequirePermissions,
  RequireRoles,
} from '../authorization/authorization.decorator';
import { OptionalAccessTokenGuard } from '../authorization/optional-access-token.guard';
import { PolicyGuard } from '../authorization/policy.guard';
import type { RequestPrincipal } from '../security/security-context';
import {
  AvailabilityQueryDto,
  CreatePricingQuoteDto,
  RecordRenterSearchDto,
  SearchVehiclesDto,
} from './discovery.dto';
import { FavoritesService } from './favorites.service';
import { PricingQuotesService } from './pricing-quotes.service';
import { PublicVehiclesService } from './public-vehicles.service';
import { RenterHistoryService } from './renter-history.service';

@ApiTags('Public vehicle discovery')
@Controller('vehicles')
export class PublicVehiclesController {
  constructor(private readonly vehicles: PublicVehiclesService) {}

  @Get('search')
  @UseGuards(OptionalAccessTokenGuard)
  search(@Query() input: SearchVehiclesDto, @Req() request: Request) {
    return this.vehicles.search(input, request.principal, requestMetadata(request).correlationId);
  }

  @Get('reference-data')
  referenceData() {
    return this.vehicles.referenceData();
  }

  @Get(':vehicleId/availability')
  availability(@Param('vehicleId') id: string, @Query() input: AvailabilityQueryDto) {
    return this.vehicles.availabilityFor(id, input.start, input.end);
  }

  @Get(':vehicleId')
  @UseGuards(OptionalAccessTokenGuard)
  detail(@Param('vehicleId') id: string, @Req() request: Request) {
    return this.vehicles.detail(id, request.principal, requestMetadata(request).correlationId);
  }
}

@ApiTags('Public host profiles')
@Controller('hosts')
export class PublicHostsController {
  constructor(private readonly vehicles: PublicVehiclesService) {}

  @Get(':publicReference')
  profile(@Param('publicReference') publicReference: string) {
    return this.vehicles.host(publicReference);
  }
}

@ApiBearerAuth()
@ApiTags('Pricing quotes')
@Controller()
@RequireRoles(RoleCode.RENTER)
@UseGuards(AccessTokenGuard, PolicyGuard)
export class PricingQuotesController {
  constructor(private readonly quotes: PricingQuotesService) {}

  @Post('vehicles/:vehicleId/quotes')
  create(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('vehicleId') vehicleId: string,
    @Body() input: CreatePricingQuoteDto,
    @Req() request: Request,
  ) {
    return this.quotes.create(
      principal.userId,
      vehicleId,
      input,
      requestMetadata(request).correlationId,
    );
  }

  @Get('quotes/:quoteId')
  get(@CurrentPrincipal() principal: RequestPrincipal, @Param('quoteId') quoteId: string) {
    return this.quotes.get(principal.userId, quoteId);
  }
}

@ApiBearerAuth()
@ApiTags('Renter favorites')
@Controller('favorites')
@RequireRoles(RoleCode.RENTER)
@UseGuards(AccessTokenGuard, PolicyGuard)
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  list(@CurrentPrincipal() principal: RequestPrincipal) {
    return this.favorites.list(principal.userId);
  }

  @Put(':vehicleId')
  add(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('vehicleId') vehicleId: string,
    @Req() request: Request,
  ) {
    return this.favorites.add(principal.userId, vehicleId, requestMetadata(request).correlationId);
  }

  @Delete(':vehicleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentPrincipal() principal: RequestPrincipal, @Param('vehicleId') vehicleId: string) {
    return this.favorites.remove(principal.userId, vehicleId);
  }
}

@ApiBearerAuth()
@ApiTags('Renter discovery history')
@Controller('me/discovery-history')
@RequireRoles(RoleCode.RENTER)
@UseGuards(AccessTokenGuard, PolicyGuard)
export class RenterHistoryController {
  constructor(private readonly history: RenterHistoryService) {}

  @Post('searches')
  recordSearch(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Body() input: RecordRenterSearchDto,
  ) {
    return this.history.recordSearch(principal.userId, input);
  }

  @Get('searches')
  listSearches(@CurrentPrincipal() principal: RequestPrincipal) {
    return this.history.listSearches(principal.userId);
  }

  @Get('vehicles')
  listVehicleViews(@CurrentPrincipal() principal: RequestPrincipal) {
    return this.history.listVehicleViews(principal.userId);
  }
}

@ApiBearerAuth()
@ApiTags('Admin vehicle visibility')
@Controller('admin/vehicles')
@RequirePermissions('vehicles.read')
@UseGuards(AccessTokenGuard, PolicyGuard)
export class AdminVehicleVisibilityController {
  constructor(private readonly vehicles: PublicVehiclesService) {}

  @Get(':vehicleId/public-visibility')
  diagnostic(@Param('vehicleId') vehicleId: string) {
    return this.vehicles.diagnostic(vehicleId);
  }
}
