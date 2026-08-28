import { Global, Module } from '@nestjs/common';
import { DevelopmentEmailProvider, DevelopmentSmsProvider } from './development-delivery.provider';
import { DevelopmentDeliveryInbox } from './development-delivery.provider';
import { DevelopmentDeliveryController } from './development-delivery.controller';
import { EmailProvider, SmsProvider } from './delivery.provider';

@Global()
@Module({
  controllers: [DevelopmentDeliveryController],
  exports: [EmailProvider, SmsProvider, DevelopmentDeliveryInbox],
  providers: [
    DevelopmentDeliveryInbox,
    { provide: EmailProvider, useClass: DevelopmentEmailProvider },
    { provide: SmsProvider, useClass: DevelopmentSmsProvider },
  ],
})
export class ProvidersModule {}
