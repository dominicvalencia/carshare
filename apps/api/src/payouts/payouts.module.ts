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
  OwnerPayoutsController,
  XenditPayoutWebhooksController,
} from './payouts.controller';
import { PayoutsService } from './payouts.service';

@Module({
  controllers: [
    OwnerPayoutAccountsController,
    OwnerPayoutsController,
    AdminPayoutsController,
    AdminPayoutBatchesController,
    AdminPayoutEligibilityController,
    XenditPayoutWebhooksController,
  ],
  exports: [PayoutsService, PAYOUT_PROVIDER],
  providers: [
    payoutProviderFactory,
    PayoutProviderCapabilitiesService,
    PayoutEncryptionService,
    PayoutEligibilityService,
    PayoutsService,
  ],
})
export class PayoutsModule {}
