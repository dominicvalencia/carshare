import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
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
  CreatePayoutAccountDto,
  CreatePayoutBatchDto,
  CreatePayoutDto,
  DisablePayoutAccountDto,
  PayoutApprovalDto,
  PayoutReasonDto,
  SetPayoutEligibilityDto,
} from './payouts.dto';
import { PayoutProviderCapabilitiesService } from './payout-provider.factory';
import { PayoutsService } from './payouts.service';

@ApiBearerAuth()
@ApiTags('Owner payout accounts')
@Controller('owner/payout-accounts')
@RequireRoles(RoleCode.OWNER)
@UseGuards(AccessTokenGuard, PolicyGuard)
export class OwnerPayoutAccountsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get()
  list(@CurrentPrincipal() principal: RequestPrincipal) {
    return this.payouts.ownerAccounts(principal.userId);
  }

  @Post()
  create(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Body() input: CreatePayoutAccountDto,
    @Req() request: Request,
  ) {
    return this.payouts.addOwnerAccount(principal.userId, input, requestMetadata(request));
  }

  @Post(':id/default')
  setDefault(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    return this.payouts.setDefault(principal.userId, id, requestMetadata(request));
  }

  @Post(':id/disable')
  disable(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: DisablePayoutAccountDto,
    @Req() request: Request,
  ) {
    return this.payouts.disableAccount(
      principal.userId,
      id,
      input.reason,
      requestMetadata(request),
    );
  }
}

@ApiBearerAuth()
@ApiTags('Owner payouts')
@Controller('owner/payouts')
@RequireRoles(RoleCode.OWNER)
@UseGuards(AccessTokenGuard, PolicyGuard)
export class OwnerPayoutsController {
  constructor(private readonly payouts: PayoutsService) {}
  @Get() list(@CurrentPrincipal() principal: RequestPrincipal) {
    return this.payouts.ownerPayouts(principal.userId);
  }
  @Get(':id') detail(@CurrentPrincipal() principal: RequestPrincipal, @Param('id') id: string) {
    return this.payouts.ownerPayouts(principal.userId, id);
  }
}

@ApiBearerAuth()
@ApiTags('Admin payouts')
@Controller('admin/payouts')
@UseGuards(AccessTokenGuard, PolicyGuard)
export class AdminPayoutsController {
  constructor(
    private readonly payouts: PayoutsService,
    private readonly capabilities: PayoutProviderCapabilitiesService,
  ) {}

  @Get('capabilities')
  @RequirePermissions('payouts.read')
  providerCapabilities() {
    return this.capabilities.get();
  }

  @Get('queue')
  @RequirePermissions('payouts.read')
  queue() {
    return this.payouts.adminQueue();
  }

  @Get()
  @RequirePermissions('payouts.read')
  list() {
    return this.payouts.adminPayouts();
  }

  @Get(':id')
  @RequirePermissions('payouts.read')
  detail(@Param('id') id: string) {
    return this.payouts.adminPayouts(id);
  }

  @Post()
  @RequirePermissions('payouts.create')
  create(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Body() input: CreatePayoutDto,
    @Req() request: Request,
  ) {
    return this.payouts.createPayout(principal.userId, input, requestMetadata(request));
  }

  @Post(':id/approve')
  @RequirePermissions('payouts.approve')
  approve(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: PayoutApprovalDto,
    @Req() request: Request,
  ) {
    return this.payouts.approve(principal.userId, id, input.note, requestMetadata(request));
  }

  @Post(':id/submit')
  @RequirePermissions('payouts.submit')
  submit(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    return this.payouts.submit(principal.userId, id, requestMetadata(request));
  }

  @Post(':id/cancel')
  @RequirePermissions('payouts.cancel')
  cancel(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: PayoutReasonDto,
    @Req() request: Request,
  ) {
    return this.payouts.cancel(principal.userId, id, input.reason, requestMetadata(request));
  }

  @Post(':id/reconcile')
  @RequirePermissions('payouts.submit')
  reconcile(@Param('id') id: string, @Req() request: Request) {
    return this.payouts.reconcilePayout(id, requestMetadata(request));
  }
}

@ApiBearerAuth()
@ApiTags('Admin payout batches')
@Controller('admin/payout-batches')
@UseGuards(AccessTokenGuard, PolicyGuard)
export class AdminPayoutBatchesController {
  constructor(private readonly payouts: PayoutsService) {}

  @Post()
  @RequirePermissions('payouts.create')
  create(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Body() input: CreatePayoutBatchDto,
    @Req() request: Request,
  ) {
    return this.payouts.createBatch(principal.userId, input, requestMetadata(request));
  }
}

@ApiBearerAuth()
@ApiTags('Admin payout eligibility')
@Controller('admin/owners/:ownerProfileId/payout-eligibility')
@UseGuards(AccessTokenGuard, PolicyGuard)
export class AdminPayoutEligibilityController {
  constructor(private readonly payouts: PayoutsService) {}

  @Post()
  @RequirePermissions('payout_accounts.manage')
  set(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('ownerProfileId') ownerProfileId: string,
    @Body() input: SetPayoutEligibilityDto,
    @Req() request: Request,
  ) {
    return this.payouts.setEligibility(
      principal.userId,
      ownerProfileId,
      input.status,
      input.reason,
      requestMetadata(request),
    );
  }
}

@ApiTags('Payout webhooks')
@Controller('webhooks/xendit/payouts')
export class XenditPayoutWebhooksController {
  constructor(private readonly payouts: PayoutsService) {}

  @Post()
  receive(
    @Body() body: unknown,
    @Headers('x-callback-token') callbackToken: string | undefined,
    @Req() request: RawBodyRequest<Request>,
  ) {
    return this.payouts.receiveWebhook(
      {
        ...(callbackToken ? { callbackToken } : {}),
        payload: body,
        rawBody: request.rawBody ?? Buffer.from(JSON.stringify(body)),
      },
      requestMetadata(request),
    );
  }
}
