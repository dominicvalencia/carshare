import { Module } from '@nestjs/common';
import { PayoutEligibilityService } from './payout-eligibility.service';
import { PayoutEncryptionService } from './payout-encryption.service';
import {
  PAYOUT_PROVIDER,
  payoutProviderFactory,
  PayoutProviderCapabilitiesService,
} from './payout-provider.factory';
import {
  AdminPayoutBatchesController,
  AdminPayoutEligibilityController,
  AdminPayoutsController,
  OwnerPayoutAccountsController,
  OwnerPayoutMethodsController,
  OwnerPayoutsController,
  XenditPayoutWebhooksController,
} from './payouts.controller';
import { PayoutsService } from './payouts.service';

@Module({
  controllers: [
    OwnerPayoutAccountsController,
    OwnerPayoutMethodsController,
    OwnerPayoutsController,
    AdminPayoutsController,
    AdminPayoutBatchesController,
    AdminPayoutEligibilityController,
    XenditPayoutWebhooksController,
  ],
  exports: [PayoutEligibilityService, PayoutsService, PAYOUT_PROVIDER],
  providers: [
    payoutProviderFactory,
    PayoutProviderCapabilitiesService,
    PayoutEncryptionService,
    PayoutEligibilityService,
    PayoutsService,
  ],
})
export class PayoutsModule {}
