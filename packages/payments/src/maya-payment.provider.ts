import { createHash } from 'node:crypto';
import {
  type AuthorizePaymentInput,
  type PaymentProvider,
  PaymentProviderError,
  type ProviderOperationResult,
  type ProviderPaymentState,
  type ProviderPaymentStatus,
  type ReferencedPaymentInput,
  type RefundPaymentInput,
  type VerifiedWebhookEvent,
  type WebhookVerificationInput,
} from './payment-provider';

export interface MayaPaymentProviderOptions {
  readonly authCaptureEnabled: boolean;
  readonly baseUrl: string;
  readonly cancelUrl: string;
  readonly failureUrl: string;
  readonly publicKey: string;
  readonly securityDepositPreauthorizationEnabled?: boolean;
  readonly secretKey: string;
  readonly successUrl: string;
  readonly voidRefundEnabled: boolean;
  readonly webhookAllowedIps: readonly string[];
}

export interface MayaCheckoutInput extends AuthorizePaymentInput {
  readonly authorizationType?: 'NORMAL' | 'PREAUTHORIZATION';
}

interface MayaResponse {
  checkoutId?: string;
  paymentId?: string;
  redirectUrl?: string;
  status?: string;
  rrn?: string;
  id?: string;
  updatedAt?: string;
  amount?: number | string | { value?: number; currency?: string };
  currency?: string;
  refundedAmount?: { value?: number; currency?: string };
}

type MayaRetrievalResponse = MayaResponse | readonly MayaResponse[];

export interface MayaProviderDiagnostics {
  readonly errorCode?: string;
  readonly httpStatus?: number;
  readonly reason?: string;
  readonly requestReference?: string;
}

export class MayaPaymentProviderError extends PaymentProviderError {
  constructor(
    message: string,
    category: 'CONFIGURATION' | 'PROVIDER_UNAVAILABLE',
    readonly diagnostics: MayaProviderDiagnostics,
  ) {
    super(message, category);
    this.name = 'MayaPaymentProviderError';
  }
}

const terminalFailures = new Set([
  'AUTH_FAILED',
  'PAYMENT_FAILED',
  'PAYMENT_EXPIRED',
  'PAYMENT_CANCELLED',
]);

const pendingAuthorizationStates = new Set([
  'PENDING',
  'PENDING_TOKEN',
  'PENDING_PAYMENT',
  'FOR_AUTHENTICATION',
  'AUTHENTICATING',
  'AUTH_SUCCESS',
  'PAYMENT_PROCESSING',
]);

export class MayaPaymentProvider implements PaymentProvider {
  readonly code = 'MAYA' as const;
  readonly capabilities;

  constructor(private readonly options: MayaPaymentProviderOptions) {
    this.capabilities = Object.freeze({
      authorizationHoldDurationSeconds: options.authCaptureEnabled ? 6 * 24 * 60 * 60 : null,
      evidence: Object.freeze({
        supportsAuthorizationExpiryLookup: 'UNPROVEN' as const,
        supportsAuthorizationRetrieval: 'SUPPORTED' as const,
        supportsFullCapture: options.authCaptureEnabled
          ? ('SUPPORTED' as const)
          : ('UNSUPPORTED' as const),
        supportsFullVoid: options.voidRefundEnabled
          ? ('SUPPORTED' as const)
          : ('UNSUPPORTED' as const),
        supportsIdempotentReplayAfterTimeout: 'UNPROVEN' as const,
        supportsMultipleCaptures: 'UNSUPPORTED' as const,
        supportsOperationSpecificRetrieval: 'UNPROVEN' as const,
        supportsPartialCapture: 'UNSUPPORTED' as const,
        supportsPartialRefund: options.voidRefundEnabled
          ? ('SUPPORTED' as const)
          : ('UNSUPPORTED' as const),
        supportsPartialVoid: 'UNSUPPORTED' as const,
        supportsRefund: options.voidRefundEnabled
          ? ('SUPPORTED' as const)
          : ('UNSUPPORTED' as const),
        supportsRequestReferenceRetrieval: 'SUPPORTED' as const,
        supportsSecurityDepositUtilization: 'UNSUPPORTED' as const,
        supportsWebhookOperationAmount: 'UNPROVEN' as const,
        supportsWebhookOperationIdentity: 'UNPROVEN' as const,
      }),
      supportsAuthorization: options.authCaptureEnabled,
      supportsAuthorizationVoid: options.voidRefundEnabled,
      supportsAdditionalPaymentAuthorization: options.authCaptureEnabled,
      supportsOffSessionAdditionalCharge: false,
      supportsPartialCapture: false,
      supportsPartialRefund: options.voidRefundEnabled,
      supportsRefund: options.voidRefundEnabled,
      supportsSecurityDeposit:
        options.authCaptureEnabled &&
        options.voidRefundEnabled &&
        Boolean(options.securityDepositPreauthorizationEnabled),
      supportsSecurityDepositUtilization: false,
      supportsWebhooks: true,
    });
  }

  async authorize(input: AuthorizePaymentInput): Promise<ProviderOperationResult> {
    this.requireCapability(this.capabilities.supportsAuthorization, 'Maya authorization/capture');
    if (
      input.authorizationType === 'PREAUTHORIZATION' &&
      !this.capabilities.supportsSecurityDeposit
    )
      throw new PaymentProviderError(
        'Maya security deposit PREAUTHORIZATION is not enabled.',
        'CONFIGURATION',
      );
    return this.createCheckout({
      ...input,
      authorizationType: input.authorizationType ?? 'NORMAL',
    });
  }

  async createCheckout(input: MayaCheckoutInput): Promise<ProviderOperationResult> {
    if (input.currency !== 'PHP' || input.amountMinor <= 0n || input.amountMinor % 1n !== 0n) {
      throw new PaymentProviderError(
        'Maya Checkout requires a positive PHP amount.',
        'CONFIGURATION',
      );
    }
    const body = {
      totalAmount: {
        value: Number(input.amountMinor) / 100,
        currency: input.currency,
        details: { subtotal: Number(input.amountMinor) / 100 },
      },
      buyer: input.customerEmail ? { contact: { email: input.customerEmail } } : undefined,
      items: [
        {
          name: input.description,
          quantity: 1,
          code: input.requestReference,
          amount: { value: Number(input.amountMinor) / 100 },
          totalAmount: { value: Number(input.amountMinor) / 100 },
        },
      ],
      redirectUrl: {
        success: this.options.successUrl,
        failure: this.options.failureUrl,
        cancel: this.options.cancelUrl,
      },
      requestReferenceNumber: input.requestReference,
      ...(input.authorizationType ? { authorizationType: input.authorizationType } : {}),
    };
    const { data: response, httpStatus } = await this.request<MayaResponse>(
      '/checkout/v1/checkouts',
      'POST',
      body,
      this.options.publicKey,
      input.idempotencyKey,
    );
    const externalPaymentId = response.paymentId ?? response.checkoutId;
    if (!externalPaymentId || !response.redirectUrl) {
      const diagnostics = safeMayaDiagnostics(httpStatus, response);
      throw new MayaPaymentProviderError(
        'Maya returned an incomplete Checkout response.',
        'PROVIDER_UNAVAILABLE',
        {
          ...diagnostics,
          reason:
            diagnostics.reason ??
            `Missing ${[
              !externalPaymentId ? 'checkout identifier' : undefined,
              !response.redirectUrl ? 'hosted checkout URL' : undefined,
            ]
              .filter(Boolean)
              .join(' and ')}.`,
          requestReference: input.requestReference,
        },
      );
    }
    return {
      customerActionUrl: response.redirectUrl,
      externalPaymentId,
      kind: 'ACTION_REQUIRED',
      providerState: response.status ?? 'CHECKOUT_CREATED',
      ...(response.checkoutId ? { safeMetadata: { checkoutId: response.checkoutId } } : {}),
    };
  }

  capture(input: ReferencedPaymentInput): Promise<ProviderOperationResult> {
    this.requireCapability(this.capabilities.supportsAuthorization, 'Maya capture');
    return this.financialAction(
      `/payments/v1/payments/${encodeURIComponent(input.externalPaymentId)}/capture`,
      input,
    );
  }

  voidAuthorization(input: ReferencedPaymentInput): Promise<ProviderOperationResult> {
    this.requireCapability(this.capabilities.supportsAuthorizationVoid, 'Maya authorization void');
    return this.financialAction(
      `/payments/v1/payments/${encodeURIComponent(input.externalPaymentId)}/voids`,
      input,
      { reason: 'CarShare authorization release.' },
      false,
    );
  }

  refund(input: RefundPaymentInput): Promise<ProviderOperationResult> {
    this.requireCapability(this.capabilities.supportsRefund, 'Maya refund');
    return this.financialAction(
      `/payments/v1/payments/${encodeURIComponent(input.externalPaymentId)}/refunds`,
      input,
      { reason: input.reason },
    );
  }

  async retrievePayment(externalPaymentId: string): Promise<ProviderPaymentStatus> {
    const { data } = await this.request<MayaRetrievalResponse>(
      `/payments/v1/payments/${encodeURIComponent(externalPaymentId)}`,
      'GET',
      undefined,
      this.options.secretKey,
    );
    const response = this.selectRetrievedPayment(data, externalPaymentId);
    return this.paymentStatus(response, externalPaymentId);
  }

  async retrievePaymentByRequestReference(
    requestReference: string,
  ): Promise<ProviderPaymentStatus> {
    const { data } = await this.request<MayaRetrievalResponse>(
      `/payments/v1/payment-rrns/${encodeURIComponent(requestReference)}`,
      'GET',
      undefined,
      this.options.secretKey,
    );
    const response = this.selectRetrievedPayment(data);
    return this.paymentStatus(response, response.paymentId ?? response.id ?? '');
  }

  private paymentStatus(
    response: MayaResponse,
    fallbackExternalPaymentId: string,
  ): ProviderPaymentStatus {
    const providerState = response.status ?? 'UNKNOWN';
    const amount =
      typeof response.amount === 'object' ? response.amount.value : Number(response.amount);
    const currency =
      typeof response.amount === 'object' ? response.amount.currency : response.currency;
    return {
      ...(currency ? { currency } : {}),
      externalPaymentId: response.paymentId ?? response.id ?? fallbackExternalPaymentId,
      ...(amount !== undefined && Number.isFinite(amount)
        ? { authorizedAmountMinor: BigInt(Math.round(amount * 100)) }
        : {}),
      providerState,
      ...(response.refundedAmount?.value !== undefined
        ? { refundedAmountMinor: BigInt(Math.round(response.refundedAmount.value * 100)) }
        : {}),
      state: this.normalizeState(providerState),
    };
  }

  private selectRetrievedPayment(
    response: MayaRetrievalResponse,
    expectedPaymentId?: string,
  ): MayaResponse {
    if (!Array.isArray(response)) return response as MayaResponse;
    if (!expectedPaymentId && response.length !== 1)
      throw new MayaPaymentProviderError(
        'Maya returned an ambiguous request-reference lookup.',
        'PROVIDER_UNAVAILABLE',
        {
          reason: `Expected one payment for the request reference but received ${response.length}.`,
        },
      );
    const selected = expectedPaymentId
      ? response.find((candidate) =>
          [candidate.paymentId, candidate.id].includes(expectedPaymentId),
        )
      : response[0];
    if (!selected)
      throw new MayaPaymentProviderError(
        'Maya did not return the requested payment.',
        'PROVIDER_UNAVAILABLE',
        { reason: 'The retrieval response did not contain a matching payment.' },
      );
    return selected;
  }

  async verifyWebhook(input: WebhookVerificationInput): Promise<VerifiedWebhookEvent> {
    const sourceIp = normalizeIp(input.sourceIp);
    if (!sourceIp || !this.options.webhookAllowedIps.includes(sourceIp)) {
      throw new PaymentProviderError(
        'The Maya webhook source IP is not allowlisted.',
        'INVALID_WEBHOOK',
      );
    }
    if (!isRecord(input.payload)) {
      throw new PaymentProviderError('The Maya webhook payload is invalid.', 'INVALID_WEBHOOK');
    }
    const paymentId = stringValue(input.payload.id) ?? stringValue(input.payload.paymentId);
    const status = stringValue(input.payload.status);
    if (!paymentId || !status) {
      throw new PaymentProviderError(
        'The Maya webhook is missing payment identity or status.',
        'INVALID_WEBHOOK',
      );
    }
    const updatedAt =
      stringValue(input.payload.updatedAt) ?? stringValue(input.payload.createdAt) ?? '';
    return {
      eventType: status,
      externalEventId: createHash('sha256')
        .update(`${paymentId}|${status}|${updatedAt}`)
        .digest('hex'),
      providerPaymentId: paymentId,
      redactedPayload: { id: paymentId, status, updatedAt: updatedAt || null },
    };
  }

  private async financialAction(
    path: string,
    input: ReferencedPaymentInput,
    extra: Readonly<Record<string, unknown>> = {},
    includeAmount = true,
  ): Promise<ProviderOperationResult> {
    const { data: response } = await this.request<MayaResponse>(
      path,
      'POST',
      {
        ...extra,
        ...(includeAmount
          ? {
              amount: { value: Number(input.amountMinor) / 100, currency: input.currency },
              requestReferenceNumber: input.requestReference,
            }
          : {}),
      },
      this.options.secretKey,
      input.idempotencyKey,
    );
    if (response.status === 'SUCCESS') {
      return {
        ...((response.id ?? response.rrn)
          ? { externalOperationId: (response.id ?? response.rrn)! }
          : {}),
        externalPaymentId: response.paymentId ?? input.externalPaymentId,
        kind: 'SUCCEEDED',
        providerState: response.status,
      };
    }
    const state = this.normalizeState(response.status ?? 'UNKNOWN');
    if (state === 'UNKNOWN' || state === 'PENDING') {
      return { kind: 'UNKNOWN', providerState: response.status ?? 'UNKNOWN' };
    }
    if (state === 'FAILED') {
      return { kind: 'DECLINED', providerState: response.status ?? 'FAILED' };
    }
    return {
      ...((response.id ?? response.rrn)
        ? { externalOperationId: (response.id ?? response.rrn)! }
        : {}),
      externalPaymentId: response.paymentId ?? input.externalPaymentId,
      kind: 'SUCCEEDED',
      ...(response.status ? { providerState: response.status } : {}),
    };
  }

  private normalizeState(status: string): ProviderPaymentState {
    if (status === 'AUTHORIZED') return 'AUTHORIZED';
    if (status === 'PAYMENT_SUCCESS' || status === 'CAPTURED') return 'CAPTURED';
    if (status === 'VOIDED' || status === 'PAYMENT_VOIDED') return 'VOIDED';
    if (terminalFailures.has(status)) return 'FAILED';
    if (pendingAuthorizationStates.has(status)) return 'PENDING';
    return 'UNKNOWN';
  }

  private requireCapability(enabled: boolean, name: string): void {
    if (!enabled)
      throw new PaymentProviderError(
        `${name} is not enabled for this merchant account.`,
        'CONFIGURATION',
      );
  }

  private async request<T>(
    path: string,
    method: 'GET' | 'POST',
    body: unknown,
    key: string,
    idempotencyKey?: string,
  ): Promise<{ readonly data: T; readonly httpStatus: number }> {
    try {
      const response = await fetch(`${this.options.baseUrl}${path}`, {
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: {
          Accept: 'application/json',
          Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        method,
        signal: AbortSignal.timeout(15_000),
      });
      const payload = (await response.json()) as T;
      const diagnostics = safeMayaDiagnostics(response.status, payload);
      if (response.status >= 500) {
        throw new MayaPaymentProviderError(
          `Maya returned HTTP ${response.status}.`,
          'PROVIDER_UNAVAILABLE',
          diagnostics,
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new MayaPaymentProviderError(
          'Maya rejected the merchant credentials or required capability.',
          'CONFIGURATION',
          diagnostics,
        );
      }
      if ([408, 409, 425, 429].includes(response.status)) {
        throw new MayaPaymentProviderError(
          `Maya returned an indeterminate HTTP ${response.status}; reconcile before retrying.`,
          'PROVIDER_UNAVAILABLE',
          diagnostics,
        );
      }
      if (!response.ok) {
        throw new MayaPaymentProviderError(
          'Maya rejected the payment request.',
          'CONFIGURATION',
          diagnostics,
        );
      }
      return { data: payload, httpStatus: response.status };
    } catch (error) {
      if (error instanceof PaymentProviderError) throw error;
      throw new PaymentProviderError(
        'Maya could not be reached; the result must be reconciled.',
        'PROVIDER_UNAVAILABLE',
      );
    }
  }
}

function normalizeIp(value: string | undefined): string | undefined {
  return value?.replace(/^::ffff:/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function safeMayaDiagnostics(httpStatus: number, payload: unknown): MayaProviderDiagnostics {
  if (!isRecord(payload)) return { httpStatus };
  const errorCode = stringValue(payload.code) ?? stringValue(payload.errorCode);
  const rawReason = stringValue(payload.message) ?? stringValue(payload.reason);
  const reason = rawReason
    ?.replace(/[\r\n\t]/g, ' ')
    .replace(/\b(?:pk|sk)-[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED]')
    .replace(/\b\d{12,19}\b/g, '[REDACTED]')
    .slice(0, 200);
  return {
    httpStatus,
    ...(errorCode ? { errorCode: errorCode.slice(0, 80) } : {}),
    ...(reason ? { reason } : {}),
  };
}
