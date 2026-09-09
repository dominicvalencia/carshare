import { resolve } from 'node:path';
import { config as loadEnvironment } from 'dotenv';
import { parseApiEnvironment } from '@carrental/config';
import { MayaPaymentProvider, MayaPaymentProviderError } from '@carrental/payments';
import {
  assertMayaCertificationReturnUrls,
  certifyMayaCheckoutOnce,
  MayaCertificationError,
} from './maya-certification';

async function main(): Promise<void> {
  loadEnvironment({ path: resolve(__dirname, '../../../../.env'), quiet: true });
  const environment = parseApiEnvironment(process.env);
  if (environment.APP_ENV !== 'local' && environment.APP_ENV !== 'test')
    throw new Error('MAYA_CERTIFICATION_REQUIRES_LOCAL_OR_TEST');
  if (!environment.MAYA_CERTIFICATION_ENABLED)
    throw new Error('MAYA_CERTIFICATION_ENABLED must be true for the explicit local command.');
  if (environment.PAYMENT_PROVIDER !== 'maya' || environment.MAYA_ENVIRONMENT !== 'sandbox')
    throw new Error('MAYA_CERTIFICATION_REQUIRES_MAYA_SANDBOX');
  if (environment.PAYMENTS_ENABLED)
    throw new Error('PAYMENTS_ENABLED must remain false during isolated Maya certification.');
  if (!environment.MAYA_PUBLIC_KEY) throw new Error('MAYA_PUBLIC_KEY is required.');

  assertMayaCertificationReturnUrls([
    environment.MAYA_SUCCESS_URL,
    environment.MAYA_FAILURE_URL,
    environment.MAYA_CANCEL_URL,
  ]);
  const provider = new MayaPaymentProvider({
    authCaptureEnabled: false,
    baseUrl: 'https://pg-sandbox.paymaya.com',
    cancelUrl: environment.MAYA_CANCEL_URL,
    failureUrl: environment.MAYA_FAILURE_URL,
    publicKey: environment.MAYA_PUBLIC_KEY,
    secretKey: environment.MAYA_SECRET_KEY ?? '',
    successUrl: environment.MAYA_SUCCESS_URL,
    voidRefundEnabled: false,
    webhookAllowedIps: ['13.229.160.234', '3.1.199.75'],
  });
  const result = await certifyMayaCheckoutOnce({
    provider,
    markerPath: resolve(__dirname, '../../../../.data/provider-certifications/maya-local.sent'),
  });
  console.info('Maya sandbox checkout created. Browser return is not payment proof.', {
    checkoutUrl: result.customerActionUrl,
    providerState: result.providerState,
  });
}

void main().catch((error: unknown) => {
  if (error instanceof MayaPaymentProviderError) {
    console.error('MAYA_CERTIFICATION_PROVIDER_ERROR', {
      category: error.category,
      ...error.diagnostics,
    });
  } else if (error instanceof MayaCertificationError) {
    console.error(error.message, error.diagnostics);
  } else {
    console.error(error instanceof Error ? error.message : 'MAYA_CERTIFICATION_FAILED');
  }
  process.exitCode = 1;
});
