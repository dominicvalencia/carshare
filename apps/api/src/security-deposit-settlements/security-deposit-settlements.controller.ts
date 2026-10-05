import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
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
  PaymentOperationAdminEvidenceDto,
  SecurityDepositSettlementReasonDto,
} from './security-deposit-settlement.dto';
import { SecurityDepositSettlementsService } from './security-deposit-settlements.service';

@ApiBearerAuth()
@ApiTags('Renter Security Deposit settlements')
@RequireRoles(RoleCode.RENTER)
@UseGuards(AccessTokenGuard, PolicyGuard)
@Controller('bookings')
export class RenterSecurityDepositSettlementsController {
  constructor(private readonly settlements: SecurityDepositSettlementsService) {}

  @Get(':reference/security-deposit/settlement')
  detail(@CurrentPrincipal() principal: RequestPrincipal, @Param('reference') reference: string) {
    return this.settlements.renterProjection(principal.userId, reference);
  }
}

@ApiBearerAuth()
@ApiTags('Owner Security Deposit settlements')
@RequireRoles(RoleCode.OWNER)
@UseGuards(AccessTokenGuard, PolicyGuard)
@Controller('owner/bookings')
export class OwnerSecurityDepositSettlementsController {
  constructor(private readonly settlements: SecurityDepositSettlementsService) {}

  @Get(':reference/security-deposit/settlement')
  detail(@CurrentPrincipal() principal: RequestPrincipal, @Param('reference') reference: string) {
    return this.settlements.ownerProjection(principal.userId, reference);
  }
}

@ApiBearerAuth()
@ApiTags('Admin Security Deposit settlements')
@UseGuards(AccessTokenGuard, PolicyGuard)
@Controller('admin')
export class AdminSecurityDepositSettlementsController {
  constructor(private readonly settlements: SecurityDepositSettlementsService) {}

  @Get('bookings/:reference/security-deposit/settlements')
  @RequirePermissions('claims.read', 'payments.read')
  detail(@Param('reference') reference: string) {
    return this.settlements.adminProjection(reference);
  }

  @Post('bookings/:reference/security-deposit/settlements/review')
  @RequirePermissions('claims.review', 'additional_charges.approve')
  createReview(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: SecurityDepositSettlementReasonDto,
    @Req() request: Request,
  ) {
    return this.settlements.createReview(
      principal.userId,
      reference,
      input.reason,
      requestMetadata(request),
    );
  }

  @Post('security-deposit/settlements/:id/approve')
  @RequirePermissions('claims.review', 'additional_charges.approve')
  approve(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: SecurityDepositSettlementReasonDto,
    @Req() request: Request,
  ) {
    return this.settlements.approve(principal.userId, id, input.reason, requestMetadata(request));
  }

  @Post('security-deposit/settlements/:id/manual-review')
  @RequirePermissions('claims.review', 'payments.read')
  manualReview(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: SecurityDepositSettlementReasonDto,
    @Req() request: Request,
  ) {
    return this.settlements.manualReview(
      principal.userId,
      id,
      input.reason,
      requestMetadata(request),
    );
  }

  @Post('payment-operations/:id/evidence')
  @RequirePermissions('claims.review', 'payments.read')
  addOperationEvidence(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: PaymentOperationAdminEvidenceDto,
    @Req() request: Request,
  ) {
    return this.settlements.addAdminEvidence(principal.userId, id, input, requestMetadata(request));
  }

  @Post('payment-operations/:id/reconcile')
  @RequirePermissions('claims.review', 'payments.read')
  requestOperationReconciliation(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: SecurityDepositSettlementReasonDto,
    @Req() request: Request,
  ) {
    return this.settlements.requestOperationReconciliation(
      principal.userId,
      id,
      input.reason,
      requestMetadata(request),
    );
  }
}
