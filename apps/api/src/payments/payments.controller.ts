import { Body, Controller, Get, Ip, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
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
import { CommissionService } from './commission.service';
import {
  DisableCommissionRuleDto,
  CreateCommissionRuleDto,
  ResolveAmendmentRefundDto,
} from './payments.dto';
import { PaymentProviderCapabilitiesService } from './payment-provider.factory';
import { PaymentsService } from './payments.service';

@ApiBearerAuth()
@ApiTags('Rental payments')
@Controller('bookings/:reference/payment')
@RequireRoles(RoleCode.RENTER)
@UseGuards(AccessTokenGuard, PolicyGuard)
export class RenterPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('authorize')
  authorize(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Req() request: Request,
  ) {
    return this.payments.authorizeRental(principal.userId, reference, requestMetadata(request));
  }

  @Get()
  status(@CurrentPrincipal() principal: RequestPrincipal, @Param('reference') reference: string) {
    return this.payments.getPayment(principal.userId, reference);
  }
}

@ApiBearerAuth()
@ApiTags('Owner earnings')
@Controller('owner/earnings')
@RequireRoles(RoleCode.OWNER)
@UseGuards(AccessTokenGuard, PolicyGuard)
export class OwnerEarningsController {
  constructor(private readonly payments: PaymentsService) {}
  @Get() list(@CurrentPrincipal() principal: RequestPrincipal) {
    return this.payments.ownerEarnings(principal.userId);
  }
}

@ApiTags('Payment webhooks')
@Controller('webhooks')
export class PaymentWebhooksController {
  constructor(private readonly payments: PaymentsService) {}
  @Post('maya')
  receive(@Body() body: unknown, @Req() request: RawBodyRequest<Request>, @Ip() sourceIp: string) {
    return this.payments.receiveWebhook(
      body,
      request.rawBody ?? Buffer.from(JSON.stringify(body)),
      sourceIp,
    );
  }
}

@ApiBearerAuth()
@ApiTags('Admin finance')
@Controller('admin/finance')
@UseGuards(AccessTokenGuard, PolicyGuard)
export class AdminFinanceController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly commissions: CommissionService,
    private readonly capabilities: PaymentProviderCapabilitiesService,
  ) {}

  @Get('provider-capabilities') @RequirePermissions('payments.read') providerCapabilities() {
    return this.capabilities.get();
  }

  @Get('bookings/:reference') @RequirePermissions('payments.read') booking(
    @Param('reference') reference: string,
  ) {
    return this.payments.adminFinancialDetail(reference);
  }

  @Post('amendment-refunds/:settlementId/manual-resolution')
  @RequirePermissions('refunds.approve')
  resolveAmendmentRefund(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('settlementId') settlementId: string,
    @Body() input: ResolveAmendmentRefundDto,
  ) {
    return this.payments.resolveAmendmentRefundManually(principal.userId, settlementId, input);
  }

  @Get('commission-rules') @RequirePermissions('commissions.read') rules() {
    return this.commissions.list();
  }

  @Post('commission-rules') @RequirePermissions('commissions.manage') createRule(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Body() input: CreateCommissionRuleDto,
    @Req() request: Request,
  ) {
    return this.commissions.create(principal.userId, input, requestMetadata(request));
  }

  @Post('commission-rules/:id/disable') @RequirePermissions('commissions.manage') disableRule(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: DisableCommissionRuleDto,
    @Req() request: Request,
  ) {
    return this.commissions.disable(principal.userId, id, input.reason, requestMetadata(request));
  }
}
