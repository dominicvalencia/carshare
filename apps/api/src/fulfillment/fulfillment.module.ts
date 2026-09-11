import { Module } from '@nestjs/common';
import { FulfillmentServiceabilityService } from './fulfillment-serviceability';

@Module({
  exports: [FulfillmentServiceabilityService],
  providers: [FulfillmentServiceabilityService],
})
export class FulfillmentModule {}
