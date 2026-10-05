import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { config as loadEnvironment } from '../packages/database/node_modules/dotenv';
import {
  MayaPaymentProvider,
  MayaPaymentProviderError,
  type ProviderPaymentStatus,
} from '../packages/payments/src/index';

loadEnvironment({ path: resolve(__dirname, '../.env'), override: false, quiet: true });

const ARTIFACT_PATH = resolve(
  __dirname,
  '../.data/provider-certifications/maya-security-deposit-sandbox.json',
);

interface CertificationArtifact {
  readonly checkoutUrl?: string;
  readonly createdAt: string;
  readonly externalPaymentId: string;
  readonly requestReference: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function assertSafeEnvironment(): void {
  if (!['local', 'test'].includes(process.env.APP_ENV ?? ''))
    throw new Error('MAYA_DEPOSIT_CERTIFICATION_REQUIRES_LOCAL_OR_TEST');
  if (process.env.MAYA_ENVIRONMENT !== 'sandbox')
    throw new Error('MAYA_DEPOSIT_CERTIFICATION_REQUIRES_SANDBOX');
  if (process.env.MAYA_CERTIFICATION_ENABLED !== 'true')
    throw new Error('MAYA_CERTIFICATION_ENABLED_REQUIRED');
  if (process.env.PAYMENTS_ENABLED === 'true')
    throw new Error('APPLICATION_PAYMENTS_MUST_REMAIN_DISABLED');
  if (process.env.MAYA_AUTH_CAPTURE_ENABLED !== 'true')
    throw new Error('MAYA_AUTH_CAPTURE_ENABLED_REQUIRED');
  if (process.env.MAYA_VOID_REFUND_ENABLED !== 'true')
    throw new Error('MAYA_VOID_REFUND_ENABLED_REQUIRED');
  if (process.env.MAYA_SECURITY_DEPOSIT_PREAUTHORIZATION_ENABLED !== 'true')
    throw new Error('MAYA_SECURITY_DEPOSIT_PREAUTHORIZATION_ENABLED_REQUIRED');
}

function provider(): MayaPaymentProvider {
  assertSafeEnvironment();
  return new MayaPaymentProvider({
    authCaptureEnabled: true,
    baseUrl: 'https://pg-sandbox.paymaya.com',
    cancelUrl: 'http://localhost:8081/payment/cancel',
    failureUrl: 'http://localhost:8081/payment/failure',
    publicKey: required('MAYA_PUBLIC_KEY'),
    secretKey: required('MAYA_SECRET_KEY'),
    securityDepositPreauthorizationEnabled: true,
    successUrl: 'http://localhost:8081/payment/success',
    voidRefundEnabled: true,
    webhookAllowedIps: ['13.229.160.234', '3.1.199.75'],
  });
}

async function readArtifact(): Promise<CertificationArtifact> {
  return JSON.parse(await readFile(ARTIFACT_PATH, 'utf8')) as CertificationArtifact;
}

function safeStatus(status: ProviderPaymentStatus) {
  return {
    amountMinor: status.authorizedAmountMinor?.toString() ?? null,
    currency: status.currency ?? null,
    externalPaymentId: status.externalPaymentId,
    providerState: status.providerState,
    state: status.state,
  };
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const maya = provider();

  if (command === 'env') {
    console.info({
      apiFamily: 'MAYA_CHECKOUT',
      baseUrl: 'https://pg-sandbox.paymaya.com',
      publicKeyPresent: Boolean(process.env.MAYA_PUBLIC_KEY),
      secretKeyPresent: Boolean(process.env.MAYA_SECRET_KEY),
    });
    return;
  }

  if (command === 'authorize') {
    const requestReference = `carshare-secdep-${randomUUID()}`.slice(0, 36);
    const result = await maya.authorize({
      amountMinor: 300_000n,
      authorizationType: 'PREAUTHORIZATION',
      currency: 'PHP',
      description: 'CarShare sandbox security deposit certification',
      idempotencyKey: `security-deposit-certification:${requestReference}`,
      requestReference,
    });
    if (result.kind !== 'ACTION_REQUIRED' || !result.externalPaymentId)
      throw new Error(`MAYA_PREAUTHORIZATION_NOT_ACTIONABLE:${result.kind}`);
    await mkdir(dirname(ARTIFACT_PATH), { recursive: true, mode: 0o700 });
    await writeFile(
      ARTIFACT_PATH,
      JSON.stringify({
        checkoutUrl: result.customerActionUrl,
        createdAt: new Date().toISOString(),
        externalPaymentId: result.externalPaymentId,
        requestReference,
      } satisfies CertificationArtifact),
      { mode: 0o600 },
    );
    console.info({
      artifactWritten: true,
      externalPaymentId: result.externalPaymentId,
      kind: result.kind,
      providerState: result.providerState,
      requestReference,
    });
    return;
  }

  const artifact = await readArtifact();
  if (command === 'replay-authorize') {
    const result = await maya.authorize({
      amountMinor: 300_000n,
      authorizationType: 'PREAUTHORIZATION',
      currency: 'PHP',
      description: 'CarShare sandbox security deposit certification',
      idempotencyKey: `security-deposit-certification:${artifact.requestReference}`,
      requestReference: artifact.requestReference,
    });
    console.info({
      externalPaymentId: result.externalPaymentId ?? null,
      kind: result.kind,
      matchesOriginal: result.externalPaymentId === artifact.externalPaymentId,
      providerState: result.providerState ?? null,
      requestReference: artifact.requestReference,
    });
    return;
  }
  if (command === 'retrieve') {
    console.info(safeStatus(await maya.retrievePayment(artifact.externalPaymentId)));
    return;
  }
  if (command === 'lookup-reference') {
    console.info(
      safeStatus(await maya.retrievePaymentByRequestReference(artifact.requestReference)),
    );
    return;
  }
  if (command === 'void') {
    if (process.argv[3] !== artifact.externalPaymentId)
      throw new Error('EXPLICIT_ARTIFACT_PAYMENT_ID_REQUIRED_FOR_VOID');
    console.info(
      await maya.voidAuthorization({
        amountMinor: 300_000n,
        currency: 'PHP',
        externalPaymentId: artifact.externalPaymentId,
        idempotencyKey: `security-deposit-certification:void:${artifact.externalPaymentId}`,
        requestReference: `${artifact.requestReference}-void`.slice(0, 36),
      }),
    );
    return;
  }
  throw new Error(
    'Usage: maya-security-deposit-certification.ts <env|authorize|replay-authorize|retrieve|lookup-reference|void>',
  );
}

void main().catch((error: unknown) => {
  if (error instanceof MayaPaymentProviderError) {
    console.error('MAYA_CERTIFICATION_PROVIDER_ERROR', {
      category: error.category,
      ...error.diagnostics,
    });
  } else console.error(error instanceof Error ? error.message : 'MAYA_CERTIFICATION_FAILED');
  process.exitCode = 1;
});
