import { Controller, Get, HttpStatus, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsNumberString, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { CurrentPrincipal } from '../authorization/authorization.decorator';
import { RoleCode } from '@carrental/database';
import type { RequestPrincipal } from '../security/security-context';
import { RateLimitService } from '../security/rate-limit.service';
import { ApplicationException } from '../common/errors/application.exception';
import { GoogleLocationProvider } from './google-location.provider';
import { OwnerAccessService } from '../owner-access/owner-access.service';

class SearchLocationDto {
  @IsString() @Length(3, 120) q!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,36}$/) session!: string;
  @IsOptional() @IsUUID() ownerProfileId?: string;
}
class PlaceDetailsDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,36}$/) session!: string;
  @IsOptional() @IsUUID() ownerProfileId?: string;
}
class ReverseLocationDto {
  @IsNumberString() latitude!: string;
  @IsNumberString() longitude!: string;
  @IsOptional() @IsUUID() ownerProfileId?: string;
}

@ApiBearerAuth()
@ApiTags('Booking locations')
@Controller('locations')
@UseGuards(AccessTokenGuard)
export class LocationsController {
  constructor(
    private readonly provider: GoogleLocationProvider,
    private readonly limits: RateLimitService,
    private readonly ownerAccess: OwnerAccessService,
  ) {}

  @Get('search')
  async search(@CurrentPrincipal() principal: RequestPrincipal, @Query() input: SearchLocationDto) {
    await this.assertLocationAccess(principal, input.ownerProfileId);
    await this.limits.assertAllowed('location-search', [principal.userId], 30, 60);
    return { items: await this.provider.search(input.q.trim(), input.session) };
  }

  @Get('places/:providerReference')
  async details(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('providerReference') reference: string,
    @Query() input: PlaceDetailsDto,
  ) {
    await this.assertLocationAccess(principal, input.ownerProfileId);
    if (!/^[A-Za-z0-9_-]{8,256}$/.test(reference))
      throw new ApplicationException(
        'INVALID_LOCATION_REFERENCE',
        'Choose a valid place result.',
        HttpStatus.BAD_REQUEST,
      );
    await this.limits.assertAllowed('location-details', [principal.userId], 15, 60);
    return this.provider.details(reference, input.session);
  }

  @Get('reverse')
  async reverse(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Query() input: ReverseLocationDto,
  ) {
    await this.assertLocationAccess(principal, input.ownerProfileId);
    await this.limits.assertAllowed('location-reverse', [principal.userId], 20, 60);
    const latitude = Number(input.latitude);
    const longitude = Number(input.longitude);
    if (
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    )
      throw new ApplicationException(
        'INVALID_LOCATION_COORDINATES',
        'Choose a valid location.',
        HttpStatus.BAD_REQUEST,
      );
    return this.provider.reverseGeocode(latitude, longitude);
  }

  private async assertLocationAccess(
    principal: RequestPrincipal,
    ownerProfileId: string | undefined,
  ): Promise<void> {
    if (principal.roles.includes(RoleCode.RENTER) || principal.roles.includes(RoleCode.OWNER)) return;
    if (!ownerProfileId)
      throw new ApplicationException(
        'OWNER_WORKSPACE_REQUIRED',
        'Choose an Owner workspace before selecting a vehicle location.',
        HttpStatus.FORBIDDEN,
      );
    const access = await this.ownerAccess.resolve(principal.userId, ownerProfileId);
    this.ownerAccess.requirePermission(access, 'vehicles.create');
  }
}
