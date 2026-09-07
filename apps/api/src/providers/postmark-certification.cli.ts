import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { config as loadEnvironment } from 'dotenv';
import { parseApiEnvironment, type ApiEnvironment } from '@carrental/config';
import { PostmarkEmailProvider, PostmarkProviderError } from './external-delivery.provider';
import { certifyPostmarkOnce } from './postmark-certification';

async function main(): Promise<void> {
  loadEnvironment({ path: resolve(__dirname, '../../../../.env'), quiet: true });
  const environment = parseApiEnvironment(process.env);
  if (!environment.POSTMARK_CERTIFICATION_ENABLED)
    throw new Error('POSTMARK_CERTIFICATION_ENABLED must be true for the explicit local command.');
  const recipient = environment.POSTMARK_CERTIFICATION_RECIPIENT;
  if (!recipient) throw new Error('POSTMARK_CERTIFICATION_RECIPIENT is required.');

  const configuration = new ConfigService<ApiEnvironment, true>(environment);
  const provider = new PostmarkEmailProvider(configuration);
  const result = await certifyPostmarkOnce({
    provider,
    recipient,
    markerPath: resolve(__dirname, '../../../../.data/provider-certifications/postmark-local.sent'),
  });
  console.info('Postmark local certification accepted.', {
    provider: result.receipt.provider,
    providerMessageId: result.receipt.providerMessageId,
    status: result.receipt.status,
  });
}

void main().catch((error: unknown) => {
  if (error instanceof PostmarkProviderError) {
    console.error(error.message, error.diagnostics);
    process.exitCode = 1;
    return;
  }
  console.error(error instanceof Error ? error.message : 'POSTMARK_CERTIFICATION_FAILED');
  process.exitCode = 1;
});
