import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
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
import { PolicyGuard } from '../authorization/policy.guard';
import type { RequestPrincipal } from '../security/security-context';
import {
  AddClaimEvidenceDto,
  AdminAdjudicateClaimDto,
  ClaimListQueryDto,
  ClaimReasonDto,
  ClaimResponseDto,
  CreateEarningHoldDto,
  CreatePostReturnClaimDto,
  RefundAdditionalChargeDto,
  ResolveDisputeDto,
} from './claims.dto';
import { ClaimsService } from './claims.service';

@ApiBearerAuth()
@ApiTags('Owner post-return claims')
@RequireRoles(RoleCode.OWNER)
@UseGuards(AccessTokenGuard, PolicyGuard)
@Controller('owner')
export class OwnerClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Post('bookings/:reference/claims')
  create(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: CreatePostReturnClaimDto,
    @Req() request: Request,
  ) {
    return this.claims.createOwnerClaim(
      principal.userId,
      reference,
      input,
      requestMetadata(request),
    );
  }

  @Get('claims')
  list(@CurrentPrincipal() principal: RequestPrincipal, @Query() query: ClaimListQueryDto) {
    return this.claims.ownerClaims(principal.userId, query);
  }

  @Get('claims/:id')
  detail(@CurrentPrincipal() principal: RequestPrincipal, @Param('id') id: string) {
    return this.claims.ownerClaim(principal.userId, id);
  }

  @Post('claims/:id/evidence')
  evidence(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: AddClaimEvidenceDto,
  ) {
    return this.claims.addOwnerEvidence(principal.userId, id, input);
  }

  @Post('claims/:id/withdraw')
  withdraw(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: ClaimReasonDto,
    @Req() request: Request,
  ) {
    return this.claims.withdraw(principal.userId, id, input.reason, requestMetadata(request));
  }
}

@ApiBearerAuth()
@ApiTags('Renter post-return claims')
@RequireRoles(RoleCode.RENTER)
@UseGuards(AccessTokenGuard, PolicyGuard)
@Controller()
export class RenterClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Get('claims')
  list(@CurrentPrincipal() principal: RequestPrincipal, @Query() query: ClaimListQueryDto) {
    return this.claims.renterClaims(principal.userId, query);
  }

  @Get('claims/:id')
  detail(@CurrentPrincipal() principal: RequestPrincipal, @Param('id') id: string) {
    return this.claims.renterClaim(principal.userId, id);
  }

  @Post('claims/:id/respond')
  respond(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: ClaimResponseDto,
    @Req() request: Request,
  ) {
    return this.claims.respond(principal.userId, id, input, requestMetadata(request));
  }

  @Post('claims/:id/evidence')
  evidence(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: AddClaimEvidenceDto,
  ) {
    return this.claims.addRenterEvidence(principal.userId, id, input);
  }

  @Get('additional-charges/:id')
  charge(@CurrentPrincipal() principal: RequestPrincipal, @Param('id') id: string) {
    return this.claims.additionalCharge(principal.userId, id);
  }

  @Post('additional-charges/:id/payment')
  pay(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    return this.claims.payAdditionalCharge(principal.userId, id, requestMetadata(request));
  }
}

@ApiBearerAuth()
@ApiTags('Admin claims and disputes')
@UseGuards(AccessTokenGuard, PolicyGuard)
@Controller('admin')
export class AdminClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Get('claims')
  @RequirePermissions('claims.read')
  list(@Query() query: ClaimListQueryDto) {
    return this.claims.adminClaims(query);
  }

  @Get('claims/:id')
  @RequirePermissions('claims.read')
  detail(@Param('id') id: string) {
    return this.claims.adminClaim(id);
  }

  @Post('claims/:id/adjudicate')
  @RequirePermissions('claims.review', 'additional_charges.approve')
  adjudicate(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: AdminAdjudicateClaimDto,
    @Req() request: Request,
  ) {
    return this.claims.adjudicate(principal.userId, id, input, requestMetadata(request));
  }

  @Post('disputes/:id/resolve')
  @RequirePermissions('disputes.manage')
  resolveDispute(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: ResolveDisputeDto,
    @Req() request: Request,
  ) {
    return this.claims.resolveDispute(principal.userId, id, input, requestMetadata(request));
  }

  @Post('additional-charges/:id/refund')
  @RequirePermissions('refunds.approve', 'additional_charges.read')
  refund(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: RefundAdditionalChargeDto,
    @Req() request: Request,
  ) {
    return this.claims.refundAdditionalCharge(
      principal.userId,
      id,
      input,
      requestMetadata(request),
    );
  }

  @Post('earnings/:id/holds')
  @RequirePermissions('earnings.hold')
  hold(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: CreateEarningHoldDto,
    @Req() request: Request,
  ) {
    return this.claims.createManualHold(principal.userId, id, input, requestMetadata(request));
  }

  @Post('earnings/holds/:id/release')
  @RequirePermissions('earnings.hold')
  releaseHold(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: ClaimReasonDto,
    @Req() request: Request,
  ) {
    return this.claims.releaseManualHold(
      principal.userId,
      id,
      input.reason,
      requestMetadata(request),
    );
  }
}
