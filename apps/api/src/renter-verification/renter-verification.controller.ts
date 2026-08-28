import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RoleCode, VerificationStatus } from '@carrental/database';
import { requestMetadata } from '../auth/auth.controller';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import {
  CurrentPrincipal,
  RequirePermissions,
  RequireRoles,
} from '../authorization/authorization.decorator';
import { PolicyGuard } from '../authorization/policy.guard';
import type { RequestPrincipal } from '../security/security-context';
import {
  AddressAssessmentDto,
  AttachRenterDocumentDto,
  UpdateRenterVerificationProfileDto,
  VerificationDecisionDto,
} from './renter-verification.dto';
import { RenterVerificationService } from './renter-verification.service';

@ApiBearerAuth()
@ApiTags('Renter verification')
@Controller('renter-verification')
@RequireRoles(RoleCode.RENTER)
@UseGuards(AccessTokenGuard, PolicyGuard)
export class RenterVerificationController {
  constructor(private readonly verification: RenterVerificationService) {}
  @Get() mine(@CurrentPrincipal() principal: RequestPrincipal) {
    return this.verification.mine(principal.userId);
  }
  @Get('requirements') requirements() {
    return this.verification.requirements();
  }
  @Post('profile') profile(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Body() input: UpdateRenterVerificationProfileDto,
  ) {
    return this.verification.updateProfile(principal.userId, input);
  }
  @Post('documents') document(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Body() input: AttachRenterDocumentDto,
  ) {
    return this.verification.attachDocument(principal.userId, input);
  }
  @Post('submission') submit(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Req() request: Request,
  ) {
    return this.verification.submit(principal.userId, requestMetadata(request));
  }
}

@ApiBearerAuth()
@ApiTags('Admin renter verification')
@Controller('admin/renter-verifications')
@RequireRoles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
@UseGuards(AccessTokenGuard, PolicyGuard)
export class AdminRenterVerificationController {
  constructor(private readonly verification: RenterVerificationService) {}
  @Get() @RequirePermissions('renters.verifications.read') list(
    @Query('status') status?: VerificationStatus,
  ) {
    return this.verification.listAdmin(status);
  }
  @Get(':id') @RequirePermissions('renters.verifications.read') detail(@Param('id') id: string) {
    return this.verification.adminDetail(id);
  }
  @Post(':id/review') @RequirePermissions('renters.verifications.review') review(
    @Param('id') id: string,
    @CurrentPrincipal() actor: RequestPrincipal,
    @Req() request: Request,
  ) {
    return this.verification.beginReview(id, actor.userId, requestMetadata(request));
  }
  @Post(':id/approval') @RequirePermissions('renters.verifications.review') approve(
    @Param('id') id: string,
    @CurrentPrincipal() actor: RequestPrincipal,
    @Req() request: Request,
  ) {
    return this.verification.approve(id, actor.userId, requestMetadata(request));
  }
  @Post(':id/more-information') @RequirePermissions('renters.verifications.review') more(
    @Param('id') id: string,
    @Body() input: VerificationDecisionDto,
    @CurrentPrincipal() actor: RequestPrincipal,
    @Req() request: Request,
  ) {
    return this.verification.moreInformation(
      id,
      input.reason,
      actor.userId,
      requestMetadata(request),
    );
  }
  @Post(':id/rejection') @RequirePermissions('renters.verifications.review') reject(
    @Param('id') id: string,
    @Body() input: VerificationDecisionDto,
    @CurrentPrincipal() actor: RequestPrincipal,
    @Req() request: Request,
  ) {
    return this.verification.reject(id, input.reason, actor.userId, requestMetadata(request));
  }
  @Post(':id/suspension') @RequirePermissions('renters.verifications.suspend') suspend(
    @Param('id') id: string,
    @Body() input: VerificationDecisionDto,
    @CurrentPrincipal() actor: RequestPrincipal,
    @Req() request: Request,
  ) {
    return this.verification.suspend(id, input.reason, actor.userId, requestMetadata(request));
  }
  @Post(':id/address-assessment')
  @RequirePermissions('renters.verifications.review')
  assessAddress(
    @Param('id') id: string,
    @Body() input: AddressAssessmentDto,
    @CurrentPrincipal() actor: RequestPrincipal,
    @Req() request: Request,
  ) {
    return this.verification.assessAddress(
      id,
      input.assessment,
      input.notes,
      actor.userId,
      requestMetadata(request),
    );
  }
}
