import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@carrental/config';
import {
  FakePaymentProvider,
  MayaPaymentProvider,
  type PaymentProvider,
} from '@carrental/payments';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export function createPaymentProvider(environment: ApiEnvironment): PaymentProvider {
  if (environment.PAYMENT_PROVIDER === 'fake') return new FakePaymentProvider();
  return new MayaPaymentProvider({
    authCaptureEnabled: environment.MAYA_AUTH_CAPTURE_ENABLED,
    baseUrl:
      environment.MAYA_ENVIRONMENT === 'production'
        ? 'https://pg.maya.ph'
        : 'https://pg-sandbox.paymaya.com',
    cancelUrl: environment.MAYA_CANCEL_URL,
    failureUrl: environment.MAYA_FAILURE_URL,
    publicKey: environment.MAYA_PUBLIC_KEY!,
    secretKey: environment.MAYA_SECRET_KEY!,
    successUrl: environment.MAYA_SUCCESS_URL,
    voidRefundEnabled: environment.MAYA_VOID_REFUND_ENABLED,
    webhookAllowedIps:
      environment.MAYA_ENVIRONMENT === 'production'
        ? ['18.138.50.235', '3.1.207.200']
        : ['13.229.160.234', '3.1.199.75'],
  });
}

@Injectable()
export class PaymentProviderCapabilitiesService {
  constructor(@Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider) {}

  get() {
    return { provider: this.provider.code, ...this.provider.capabilities };
  }
}

export const paymentProviderFactory = {
  inject: [ConfigService],
  provide: PAYMENT_PROVIDER,
  useFactory: (configuration: ConfigService<ApiEnvironment, true>): PaymentProvider => {
    if (configuration.getOrThrow('PAYMENT_PROVIDER', { infer: true }) === 'fake') {
      return new FakePaymentProvider();
    }
    const mayaEnvironment = configuration.getOrThrow('MAYA_ENVIRONMENT', { infer: true });
    return new MayaPaymentProvider({
      authCaptureEnabled: configuration.getOrThrow('MAYA_AUTH_CAPTURE_ENABLED', { infer: true }),
      baseUrl:
        mayaEnvironment === 'production' ? 'https://pg.maya.ph' : 'https://pg-sandbox.paymaya.com',
      cancelUrl: configuration.getOrThrow('MAYA_CANCEL_URL', { infer: true }),
      failureUrl: configuration.getOrThrow('MAYA_FAILURE_URL', { infer: true }),
      publicKey: configuration.getOrThrow('MAYA_PUBLIC_KEY', { infer: true }),
      secretKey: configuration.getOrThrow('MAYA_SECRET_KEY', { infer: true }),
      successUrl: configuration.getOrThrow('MAYA_SUCCESS_URL', { infer: true }),
      voidRefundEnabled: configuration.getOrThrow('MAYA_VOID_REFUND_ENABLED', { infer: true }),
      webhookAllowedIps:
        mayaEnvironment === 'production'
          ? ['18.138.50.235', '3.1.207.200']
          : ['13.229.160.234', '3.1.199.75'],
    });
  },
};
