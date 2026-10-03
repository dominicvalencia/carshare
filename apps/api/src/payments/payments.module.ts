import { Module } from '@nestjs/common';
import { CommissionService } from './commission.service';
import {
  AdminFinanceController,
  OwnerEarningsController,
  PaymentWebhooksController,
  RenterPaymentsController,
} from './payments.controller';
import {
  PAYMENT_PROVIDER,
  paymentProviderFactory,
  PaymentProviderCapabilitiesService,
} from './payment-provider.factory';
import { PaymentsService } from './payments.service';
import { RenterVerificationModule } from '../renter-verification/renter-verification.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { OwnerFinancialReadModelService } from './owner-financial-read-model.service';

@Module({
  controllers: [
    RenterPaymentsController,
    OwnerEarningsController,
    PaymentWebhooksController,
    AdminFinanceController,
  ],
  exports: [PaymentsService, PAYMENT_PROVIDER],
  imports: [PayoutsModule, RenterVerificationModule],
  providers: [
    paymentProviderFactory,
    PaymentProviderCapabilitiesService,
    PaymentsService,
    CommissionService,
    OwnerFinancialReadModelService,
  ],
})
export class PaymentsModule {}
