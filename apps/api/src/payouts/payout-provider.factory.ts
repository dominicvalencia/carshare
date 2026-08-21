import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@carrental/config';
import { FakePayoutProvider, type PayoutProvider, XenditPayoutProvider } from '@carrental/payouts';

export const PAYOUT_PROVIDER = Symbol('PAYOUT_PROVIDER');

export function createPayoutProvider(environment: ApiEnvironment): PayoutProvider {
  if (environment.PAYOUT_PROVIDER === 'fake') return new FakePayoutProvider();
  return new XenditPayoutProvider({
    callbackToken: environment.XENDIT_WEBHOOK_TOKEN!,
    secretKey: environment.XENDIT_SECRET_KEY!,
  });
}

export const payoutProviderFactory = {
  inject: [ConfigService],
  provide: PAYOUT_PROVIDER,
  useFactory: (configuration: ConfigService<ApiEnvironment, true>) =>
    configuration.getOrThrow('PAYOUT_PROVIDER', { infer: true }) === 'fake'
      ? new FakePayoutProvider()
      : new XenditPayoutProvider({
          callbackToken: configuration.getOrThrow('XENDIT_WEBHOOK_TOKEN', { infer: true }),
          secretKey: configuration.getOrThrow('XENDIT_SECRET_KEY', { infer: true }),
        }),
};

@Injectable()
export class PayoutProviderCapabilitiesService {
  constructor(@Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProvider) {}
  get() {
    const capabilities = this.provider.getCapabilities();
    return {
      ...capabilities,
      maximumAmountMinor: capabilities.maximumAmountMinor?.toString() ?? null,
      minimumAmountMinor: capabilities.minimumAmountMinor?.toString() ?? null,
      provider: this.provider.code,
    };
  }
}
