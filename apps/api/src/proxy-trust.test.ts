import { ExpressAdapter } from '@nestjs/platform-express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { MayaPaymentProvider } from '@carrental/payments';
import { proxyTrustForEnvironment } from './proxy-trust';

const MAYA_SANDBOX_IP = '13.229.160.234';
const OTHER_IP = '198.51.100.20';

function provider() {
  return new MayaPaymentProvider({
    authCaptureEnabled: true,
    baseUrl: 'https://pg-sandbox.paymaya.com',
    cancelUrl: 'http://localhost/cancel',
    failureUrl: 'http://localhost/failure',
    publicKey: 'test-public-key',
    secretKey: 'test-secret-key',
    successUrl: 'http://localhost/success',
    voidRefundEnabled: true,
    webhookAllowedIps: [MAYA_SANDBOX_IP, '3.1.199.75'],
  });
}

async function forwardedWebhook(appEnvironment: 'local' | 'production', forwardedIp: string) {
  const adapter = new ExpressAdapter();
  const app = adapter.getInstance<{
    post(
      path: string,
      handler: (
        request: { readonly ip?: string },
        response: { sendStatus(status: number): void },
      ) => Promise<void>,
    ): void;
    set(name: string, value: unknown): void;
  }>();
  app.set('trust proxy', proxyTrustForEnvironment(appEnvironment));
  app.post('/api/v1/webhooks/maya', async (request_, response) => {
    try {
      await provider().verifyWebhook({
        payload: { id: 'sandbox-payment', status: 'AUTHORIZED' },
        rawBody: Buffer.from('{}'),
        sourceIp: request_.ip,
      });
      response.sendStatus(201);
    } catch {
      response.sendStatus(401);
    }
  });
  return request(app).post('/api/v1/webhooks/maya').set('X-Forwarded-For', forwardedIp).send();
}

describe('local proxy trust for Maya webhooks', () => {
  it('accepts a forwarded Maya sandbox IP through a trusted local proxy', async () => {
    expect((await forwardedWebhook('local', MAYA_SANDBOX_IP)).status).toBe(201);
  });

  it('rejects a forwarded non-Maya IP through a trusted local proxy', async () => {
    expect((await forwardedWebhook('local', OTHER_IP)).status).toBe(401);
  });

  it('does not enable forwarded-IP trust in production', async () => {
    expect(proxyTrustForEnvironment('production')).toBe(false);
    expect((await forwardedWebhook('production', MAYA_SANDBOX_IP)).status).toBe(401);
  });

  it('continues to accept a direct Maya sandbox IP', async () => {
    await expect(
      provider().verifyWebhook({
        payload: { id: 'sandbox-payment', status: 'AUTHORIZED' },
        rawBody: Buffer.from('{}'),
        sourceIp: MAYA_SANDBOX_IP,
      }),
    ).resolves.toMatchObject({
      eventType: 'AUTHORIZED',
      providerPaymentId: 'sandbox-payment',
    });
  });
});
