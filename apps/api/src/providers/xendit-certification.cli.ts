import { resolve } from 'node:path';
import { config as loadEnvironment } from 'dotenv';
import { parseApiEnvironment } from '@carrental/config';
import { XenditPaymentProvider, XenditPaymentProviderError } from '@carrental/payments';
import { certifyXenditSessionOnce } from './xendit-certification';

async function main(): Promise<void> {
  loadEnvironment({ path: resolve(__dirname, '../../../../.env'), quiet: true });
  const environment = parseApiEnvironment(process.env);
  if (!environment.XENDIT_CERTIFICATION_ENABLED)
    throw new Error('XENDIT_CERTIFICATION_ENABLED must be true for the explicit local command.');
  if (!environment.XENDIT_SECRET_KEY?.startsWith('xnd_development_'))
    throw new Error('XENDIT_CERTIFICATION_REQUIRES_TEST_SECRET_KEY');
  const result = await certifyXenditSessionOnce({
    provider: new XenditPaymentProvider({ secretKey: environment.XENDIT_SECRET_KEY }),
    markerPath: resolve(__dirname, '../../../../.data/provider-certifications/xendit-local.sent'),
  });
  console.info('Xendit test Payment Session created. Browser return is not payment proof.', {
    checkoutUrl: result.customerActionUrl,
    providerSessionId: result.externalPaymentId,
    providerState: result.providerState,
  });
}
void main().catch((error: unknown) => {
  if (error instanceof XenditPaymentProviderError)
    console.error('XENDIT_CERTIFICATION_PROVIDER_ERROR', {
      category: error.category,
      ...error.diagnostics,
    });
  else console.error(error instanceof Error ? error.message : 'XENDIT_CERTIFICATION_FAILED');
  process.exitCode = 1;
});
