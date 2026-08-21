import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { CurrentPrincipal } from '../authorization/authorization.decorator';
import { requestMetadata } from '../auth/auth.controller';
import type { RequestPrincipal } from '../security/security-context';
import { SubmitOwnerProfileDto, UpdateOwnerProfileDto } from './owners.dto';
import { OwnersService } from './owners.service';

@ApiBearerAuth()
@ApiTags('Owner onboarding')
@Controller('owners')
@UseGuards(AccessTokenGuard)
export class OwnersController {
  constructor(private readonly owners: OwnersService) {}

  @Post('onboarding')
  start(@CurrentPrincipal() principal: RequestPrincipal) {
    return this.owners.start(principal.userId);
  }

  @Get('me')
  get(@CurrentPrincipal() principal: RequestPrincipal) {
    return this.owners.get(principal.userId);
  }

  @Patch('me')
  update(@CurrentPrincipal() principal: RequestPrincipal, @Body() input: UpdateOwnerProfileDto) {
    return this.owners.update(principal.userId, input);
  }

  @Post('me/submission')
  submit(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Body() input: SubmitOwnerProfileDto,
    @Req() request: Request,
  ) {
    return this.owners.submit(principal.userId, input, requestMetadata(request));
  }

  @Get('me/operational-eligibility')
  @HttpCode(HttpStatus.OK)
  async eligibility(@CurrentPrincipal() principal: RequestPrincipal) {
    await this.owners.assertOperational(principal.userId);
    return { eligible: true };
  }
}
