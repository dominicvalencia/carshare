import { Global, Module } from '@nestjs/common';
import { DevelopmentEmailProvider, DevelopmentSmsProvider } from './development-delivery.provider';
import { DevelopmentDeliveryInbox } from './development-delivery.provider';
import { DevelopmentDeliveryController } from './development-delivery.controller';
import { EmailProvider, SmsProvider } from './delivery.provider';
import {
  DisabledEmailProvider,
  DisabledSmsProvider,
  PostmarkEmailProvider,
  SemaphoreSmsProvider,
} from './external-delivery.provider';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@carrental/config';

@Global()
@Module({
  controllers: [DevelopmentDeliveryController],
  exports: [EmailProvider, SmsProvider, DevelopmentDeliveryInbox],
  providers: [
    DevelopmentDeliveryInbox,
    DevelopmentEmailProvider,
    DevelopmentSmsProvider,
    PostmarkEmailProvider,
    SemaphoreSmsProvider,
    DisabledEmailProvider,
    DisabledSmsProvider,
    {
      provide: EmailProvider,
      inject: [
        ConfigService,
        DevelopmentEmailProvider,
        PostmarkEmailProvider,
        DisabledEmailProvider,
      ],
      useFactory: (
        config: ConfigService<ApiEnvironment, true>,
        development: DevelopmentEmailProvider,
        postmark: PostmarkEmailProvider,
        disabled: DisabledEmailProvider,
      ) => {
        const provider = config.getOrThrow('EMAIL_PROVIDER', { infer: true });
        if (config.getOrThrow('EMAIL_ENABLED', { infer: true }) && provider === 'postmark')
          return postmark;
        if (
          provider === 'development' ||
          (provider === 'disabled' &&
            ['local', 'test'].includes(config.getOrThrow('APP_ENV', { infer: true })))
        )
          return development;
        return disabled;
      },
    },
    {
      provide: SmsProvider,
      inject: [ConfigService, DevelopmentSmsProvider, SemaphoreSmsProvider, DisabledSmsProvider],
      useFactory: (
        config: ConfigService<ApiEnvironment, true>,
        development: DevelopmentSmsProvider,
        semaphore: SemaphoreSmsProvider,
        disabled: DisabledSmsProvider,
      ) => {
        const provider = config.getOrThrow('SMS_PROVIDER', { infer: true });
        if (config.getOrThrow('SMS_OTP_ENABLED', { infer: true }) && provider === 'semaphore')
          return semaphore;
        if (
          provider === 'development' ||
          (provider === 'disabled' &&
            ['local', 'test'].includes(config.getOrThrow('APP_ENV', { infer: true })))
        )
          return development;
        return disabled;
      },
    },
  ],
})
export class ProvidersModule {}
