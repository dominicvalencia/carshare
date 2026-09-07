import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { config as loadEnvironment } from 'dotenv';
import { parseApiEnvironment, type ApiEnvironment } from '@carrental/config';
import { normalizePhilippineMobile } from '../common/phone/philippine-mobile';
import { SemaphoreProviderError, SemaphoreSmsProvider } from './external-delivery.provider';
import { certifySemaphoreOnce } from './semaphore-certification';

async function main(): Promise<void> {
  loadEnvironment({ path: resolve(__dirname, '../../../../.env'), quiet: true });
  const environment = parseApiEnvironment(process.env);
  if (!environment.SEMAPHORE_CERTIFICATION_ENABLED)
    throw new Error('SEMAPHORE_CERTIFICATION_ENABLED must be true for the explicit local command.');
  const configuredRecipient = environment.SEMAPHORE_CERTIFICATION_RECIPIENT;
  if (!configuredRecipient) throw new Error('SEMAPHORE_CERTIFICATION_RECIPIENT is required.');
  const recipient = normalizePhilippineMobile(configuredRecipient);

  const configuration = new ConfigService<ApiEnvironment, true>(environment);
  const provider = new SemaphoreSmsProvider(configuration);
  const result = await certifySemaphoreOnce({
    provider,
    recipient,
    markerPath: resolve(
      __dirname,
      '../../../../.data/provider-certifications/semaphore-local.sent',
    ),
  });
  console.info('Semaphore local certification accepted.', {
    provider: result.receipt.provider,
    providerMessageId: result.receipt.providerMessageId,
    status: result.receipt.status,
  });
}

void main().catch((error: unknown) => {
  if (error instanceof SemaphoreProviderError) {
    console.error(error.message, error.diagnostics);
    process.exitCode = 1;
    return;
  }
  console.error(error instanceof Error ? error.message : 'SEMAPHORE_CERTIFICATION_FAILED');
  process.exitCode = 1;
});
