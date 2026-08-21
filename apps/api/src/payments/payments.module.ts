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

@Module({
  controllers: [
    RenterPaymentsController,
    OwnerEarningsController,
    PaymentWebhooksController,
    AdminFinanceController,
  ],
  exports: [PaymentsService, PAYMENT_PROVIDER],
  providers: [
    paymentProviderFactory,
    PaymentProviderCapabilitiesService,
    PaymentsService,
    CommissionService,
  ],
})
export class PaymentsModule {}
