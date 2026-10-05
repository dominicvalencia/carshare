import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { config as loadEnvironment } from 'dotenv';
import { parseApiEnvironment } from '@carrental/config';
import { MayaPaymentProvider, MayaPaymentProviderError } from '@carrental/payments';
import {
  assertMayaCertificationReturnUrls,
  assertMayaCertificationSafety,
  runMayaCertification,
  selectMayaCertificationScenarios,
  type MayaCertificationScenario,
} from './maya-certification';

interface Arguments {
  readonly amountMinor: bigint;
  readonly confirmExecution: boolean;
  readonly dryRun: boolean;
  readonly paymentId?: string;
  readonly requestReference?: string;
  readonly scenarios: readonly MayaCertificationScenario[];
}

function value(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

export function parseMayaCertificationArguments(argv = process.argv.slice(2)): Arguments {
  const scenarioArguments = argv
    .filter((argument) => argument.startsWith('--scenario='))
    .flatMap((argument) => argument.slice('--scenario='.length).split(','));
  const rawAmount =
    value(argv, 'amount-minor') ?? process.env.MAYA_CERTIFICATION_AMOUNT_MINOR ?? '300000';
  if (!/^\d+$/.test(rawAmount)) throw new Error('MAYA_CERTIFICATION_AMOUNT_INVALID');
  const paymentId = value(argv, 'payment-id');
  const requestReference = value(argv, 'request-reference');
  return {
    amountMinor: BigInt(rawAmount),
    confirmExecution: argv.includes('--confirm-execution'),
    dryRun: argv.includes('--dry-run'),
    ...(paymentId ? { paymentId } : {}),
    ...(requestReference ? { requestReference } : {}),
    scenarios: selectMayaCertificationScenarios(
      scenarioArguments.length ? scenarioArguments : ['authorization'],
    ),
  };
}

async function main(): Promise<void> {
  loadEnvironment({ path: resolve(__dirname, '../../../../.env'), quiet: true });
  const args = parseMayaCertificationArguments();
  const environment = parseApiEnvironment(process.env);
  assertMayaCertificationSafety(
    {
      amountMinor: args.amountMinor,
      appEnvironment: environment.APP_ENV,
      certificationEnabled: environment.MAYA_CERTIFICATION_ENABLED,
      executionConfirmed: args.confirmExecution,
      mayaEnvironment: environment.MAYA_ENVIRONMENT,
      paymentProvider: environment.PAYMENT_PROVIDER,
      paymentsEnabled: environment.PAYMENTS_ENABLED,
    },
    { dryRun: args.dryRun },
  );
  if (!environment.MAYA_PUBLIC_KEY || !environment.MAYA_SECRET_KEY)
    throw new Error('MAYA_CERTIFICATION_CREDENTIALS_REQUIRED');
  if (environment.SECURITY_DEPOSIT_SETTLEMENT_EXECUTION_ENABLED)
    throw new Error('SECURITY_DEPOSIT_SETTLEMENT_EXECUTION_MUST_REMAIN_DISABLED');
  assertMayaCertificationReturnUrls([
    environment.MAYA_SUCCESS_URL,
    environment.MAYA_FAILURE_URL,
    environment.MAYA_CANCEL_URL,
  ]);

  const runId = randomUUID();
  console.info('Maya capability certification', {
    amountMinor: args.amountMinor.toString(),
    dryRun: args.dryRun,
    environment: environment.MAYA_ENVIRONMENT,
    provider: environment.PAYMENT_PROVIDER,
    runId,
    scenarios: args.scenarios,
  });
  const provider = new MayaPaymentProvider({
    authCaptureEnabled: environment.MAYA_AUTH_CAPTURE_ENABLED,
    baseUrl: 'https://pg-sandbox.paymaya.com',
    cancelUrl: environment.MAYA_CANCEL_URL,
    failureUrl: environment.MAYA_FAILURE_URL,
    publicKey: environment.MAYA_PUBLIC_KEY,
    secretKey: environment.MAYA_SECRET_KEY,
    securityDepositPreauthorizationEnabled:
      environment.MAYA_SECURITY_DEPOSIT_PREAUTHORIZATION_ENABLED,
    successUrl: environment.MAYA_SUCCESS_URL,
    voidRefundEnabled: environment.MAYA_VOID_REFUND_ENABLED,
    webhookAllowedIps: ['13.229.160.234', '3.1.199.75'],
  });
  const report = await runMayaCertification({
    amountMinor: args.amountMinor,
    artifactPath: resolve(
      __dirname,
      `../../../../.data/provider-certifications/maya-capabilities-${runId}.json`,
    ),
    dryRun: args.dryRun,
    ...(args.paymentId ? { existingPaymentId: args.paymentId } : {}),
    ...(args.requestReference ? { existingRequestReference: args.requestReference } : {}),
    provider,
    runId,
    scenarios: args.scenarios,
  });
  console.info(
    'Maya capability certification results',
    report.evidence.map(({ capability, result, scenario }) => ({ capability, result, scenario })),
  );
  if (report.evidence.some((item) => item.result === 'FAILED')) process.exitCode = 1;
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
