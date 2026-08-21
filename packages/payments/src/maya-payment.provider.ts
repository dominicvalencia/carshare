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
  readonly secretKey: string;
  readonly successUrl: string;
  readonly voidRefundEnabled: boolean;
  readonly webhookAllowedIps: readonly string[];
}

interface MayaResponse {
  checkoutId?: string;
  paymentId?: string;
  redirectUrl?: string;
  status?: string;
  rrn?: string;
  id?: string;
  updatedAt?: string;
  amount?: { value?: number; currency?: string };
}

const terminalFailures = new Set(['PAYMENT_FAILED', 'PAYMENT_EXPIRED', 'PAYMENT_CANCELLED']);

export class MayaPaymentProvider implements PaymentProvider {
  readonly code = 'MAYA' as const;
  readonly capabilities;

  constructor(private readonly options: MayaPaymentProviderOptions) {
    this.capabilities = Object.freeze({
      authorizationHoldDurationSeconds: options.authCaptureEnabled ? 6 * 24 * 60 * 60 : null,
      supportsAuthorization: options.authCaptureEnabled,
      supportsAuthorizationVoid: options.voidRefundEnabled,
      supportsAdditionalPaymentAuthorization: options.authCaptureEnabled,
      supportsOffSessionAdditionalCharge: false,
      supportsPartialCapture: false,
      supportsPartialRefund: options.voidRefundEnabled,
      supportsRefund: options.voidRefundEnabled,
      supportsSecurityDeposit: false,
      supportsSecurityDepositUtilization: false,
      supportsWebhooks: true,
    });
  }

  async authorize(input: AuthorizePaymentInput): Promise<ProviderOperationResult> {
    this.requireCapability(this.capabilities.supportsAuthorization, 'Maya authorization/capture');
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
      authorizationType: 'NORMAL',
    };
    const response = await this.request<MayaResponse>(
      '/checkout/v1/checkouts',
      'POST',
      body,
      this.options.publicKey,
      input.idempotencyKey,
    );
    const externalPaymentId = response.paymentId ?? response.checkoutId;
    if (!externalPaymentId || !response.redirectUrl) {
      return {
        kind: 'UNKNOWN',
        providerState: response.status ?? 'CHECKOUT_CREATED_WITHOUT_REFERENCE',
      };
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
    const response = await this.request<MayaResponse>(
      `/payments/v1/payments/${encodeURIComponent(externalPaymentId)}`,
      'GET',
      undefined,
      this.options.secretKey,
    );
    const providerState = response.status ?? 'UNKNOWN';
    return {
      externalPaymentId: response.paymentId ?? response.id ?? externalPaymentId,
      providerState,
      state: this.normalizeState(providerState),
    };
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
  ): Promise<ProviderOperationResult> {
    const response = await this.request<MayaResponse>(
      path,
      'POST',
      {
        ...extra,
        amount: { value: Number(input.amountMinor) / 100, currency: input.currency },
        requestReferenceNumber: input.requestReference,
      },
      this.options.secretKey,
      input.idempotencyKey,
    );
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
    if (status === 'PENDING' || status === 'FOR_AUTHENTICATION') return 'PENDING';
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
  ): Promise<T> {
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
      if (response.status >= 500) {
        throw new PaymentProviderError(
          `Maya returned HTTP ${response.status}.`,
          'PROVIDER_UNAVAILABLE',
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new PaymentProviderError(
          'Maya rejected the merchant credentials or required capability.',
          'CONFIGURATION',
        );
      }
      if ([408, 409, 425, 429].includes(response.status)) {
        throw new PaymentProviderError(
          `Maya returned an indeterminate HTTP ${response.status}; reconcile before retrying.`,
          'PROVIDER_UNAVAILABLE',
        );
      }
      if (!response.ok) {
        return { ...(payload as object), status: 'PAYMENT_FAILED' } as T;
      }
      return payload;
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
