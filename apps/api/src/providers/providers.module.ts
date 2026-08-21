import { Global, Module } from '@nestjs/common';
import { DevelopmentEmailProvider, DevelopmentSmsProvider } from './development-delivery.provider';
import { EmailProvider, SmsProvider } from './delivery.provider';

@Global()
@Module({
  exports: [EmailProvider, SmsProvider],
  providers: [
    { provide: EmailProvider, useClass: DevelopmentEmailProvider },
    { provide: SmsProvider, useClass: DevelopmentSmsProvider },
  ],
})
export class ProvidersModule {}
