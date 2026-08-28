import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RoleCode } from '@carrental/database';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { RequireRoles } from '../authorization/authorization.decorator';
import { PolicyGuard } from '../authorization/policy.guard';
import { GeographyService } from './geography.service';

@ApiBearerAuth()
@ApiTags('Philippine geographic reference')
@Controller('geography')
@RequireRoles(RoleCode.RENTER)
@UseGuards(AccessTokenGuard, PolicyGuard)
export class GeographyController {
  constructor(private readonly geography: GeographyService) {}

  @Get('regions') regions() {
    return this.geography.regions();
  }

  @Get('regions/:regionCode/scopes') scopes(@Param('regionCode') regionCode: string) {
    return this.geography.scopes(regionCode);
  }

  @Get('regions/:regionCode/localities') localities(
    @Param('regionCode') regionCode: string,
    @Query('scopeCode') scopeCode: string,
  ) {
    return this.geography.localities(regionCode, scopeCode);
  }

  @Get('localities/:localityCode/barangays') barangays(
    @Param('localityCode') localityCode: string,
    @Query('query') query = '',
    @Query('limit') requestedLimit = '75',
  ) {
    const limit = Number.parseInt(requestedLimit, 10);
    return this.geography.barangays(localityCode, query, Number.isFinite(limit) ? limit : 75);
  }
}
