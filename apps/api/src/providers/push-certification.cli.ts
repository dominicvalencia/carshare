import { resolve } from 'node:path';
import { config as loadEnvironment } from 'dotenv';
import { parseApiEnvironment } from '@carrental/config';
import { ExpoPushProvider } from '@carrental/notifications';
import { certifyPushOnce } from './push-certification';

async function main() {
  loadEnvironment({ path: resolve(__dirname, '../../../../.env'), quiet: true });
  const environment = parseApiEnvironment(process.env);
  if (!environment.PUSH_CERTIFICATION_ENABLED)
    throw new Error('PUSH_CERTIFICATION_ENABLED must be true for the explicit local command.');
  const token = environment.PUSH_CERTIFICATION_EXPO_TOKEN;
  if (!token) throw new Error('PUSH_CERTIFICATION_EXPO_TOKEN is required.');
  const scheme = environment.APP_ENV === 'test' ? 'carshare-test' : 'carrental';
  const result = await certifyPushOnce({
    provider: new ExpoPushProvider(environment.EXPO_PUSH_ACCESS_TOKEN),
    token,
    deepLink: `${scheme}://notifications`,
    markerPath: resolve(__dirname, '../../../../.data/provider-certifications/push-local.sent'),
  });
  console.info('Expo push local certification accepted.', {
    providerReference: result.providerReference,
    status: result.status,
  });
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'PUSH_CERTIFICATION_FAILED');
  process.exitCode = 1;
});
